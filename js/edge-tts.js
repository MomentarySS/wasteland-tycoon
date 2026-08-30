// Edge 免费在线 TTS（微软 Bing 语音接口，非官方）：免 Key、国内直连
// 定位：引擎链中的「免费在线」档，失败时由 tts.js 自动降级到系统语音
// 协议：wss 连接后发 speech.config + SSML，收二进制帧（Path:audio = MP3 分片，Path:turn.end = 结束）

const TRUSTED_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const VOICE_STORAGE = 'wasteland_edge_voice';

// 中文音色（普通话 8 + 粤语 3 + 台湾 3），默认云希（偏青年男声，废土电台感）
export const EDGE_VOICES = [
  { id: 'zh-CN-YunxiNeural', name: '云希 · 青年男声（默认）' },
  { id: 'zh-CN-YunyangNeural', name: '云扬 · 新闻男声' },
  { id: 'zh-CN-YunjianNeural', name: '云健 · 磁性男声' },
  { id: 'zh-CN-YunxiaNeural', name: '云夏 · 少年男声' },
  { id: 'zh-CN-XiaoxiaoNeural', name: '晓晓 · 女声' },
  { id: 'zh-CN-XiaoyiNeural', name: '晓伊 · 女声' },
  { id: 'zh-CN-liaoning-XiaobeiNeural', name: '晓北 · 辽宁方言女声' },
  { id: 'zh-CN-shaanxi-XiaoniNeural', name: '晓妮 · 陕西方言女声' },
  { id: 'zh-HK-HiuMaanNeural', name: '曉曼 · 粤语女声' },
  { id: 'zh-HK-HiuGaaiNeural', name: '曉佳 · 粤语女声' },
  { id: 'zh-HK-WanLungNeural', name: '雲龍 · 粤语男声' },
  { id: 'zh-TW-HsiaoChenNeural', name: '曉臻 · 台湾女声' },
  { id: 'zh-TW-HsiaoYuNeural', name: '曉雨 · 台湾女声' },
  { id: 'zh-TW-YunJheNeural', name: '雲哲 · 台湾男声' },
];
export const EDGE_DEFAULT_VOICE = 'zh-CN-YunxiNeural';

let edgeVoice = EDGE_DEFAULT_VOICE;
try {
  const saved = localStorage.getItem(VOICE_STORAGE);
  if (saved && EDGE_VOICES.some(v => v.id === saved)) edgeVoice = saved;
} catch (_) {}

export function setEdgeVoice(id) {
  if (EDGE_VOICES.some(v => v.id === id)) {
    edgeVoice = id;
    try { localStorage.setItem(VOICE_STORAGE, id); } catch (_) {}
  }
}
export function getEdgeVoice() { return edgeVoice; }

/** Sec-MS-GEC 令牌：SHA256(5分钟对齐的Windows文件时间 + 令牌) 大写十六进制 */
async function secMsgGec() {
  const WIN_EPOCH = 11644473600;
  const ticksSec = Math.floor((Date.now() / 1000 + WIN_EPOCH) / 300) * 300;
  const str = String(BigInt(ticksSec) * 10000000n);
  const data = new TextEncoder().encode(str + TRUSTED_TOKEN);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function ssmlEscape(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function requestId() {
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

/** 单次合成：文本 → MP3 Blob（失败 reject） */
function synthChunk(text, voice, rate) {
  return new Promise(async (resolve, reject) => {
    const gec = await secMsgGec();
    const url = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1'
      + `?TrustedClientToken=${TRUSTED_TOKEN}&Sec-MS-GEC=${gec}&Sec-MS-GEC-Version=1-130.0.2849.68`;
    let ws;
    try { ws = new WebSocket(url); } catch (e) { reject(e); return; }
    ws.binaryType = 'arraybuffer';
    const chunks = [];
    let timer = setTimeout(() => { try { ws.close(); } catch (_) {} reject(new Error('edge 超时')); }, 25000);
    const finish = (fn) => { clearTimeout(timer); try { ws.close(); } catch (_) {} fn(); };

    ws.onopen = () => {
      const ts = new Date().toISOString();
      ws.send(`X-Timestamp:${ts}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n`
        + '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},'
        + '"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}');
      const ratePct = Math.round((Math.max(0.5, Math.min(2, rate)) - 1) * 100);
      const ssml = `<speech version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'>`
        + `<voice name='${voice}'><prosody pitch='+0Hz' rate='${ratePct >= 0 ? '+' : ''}${ratePct}%' volume='+0%'>`
        + `${ssmlEscape(text)}</prosody></voice></speech>`;
      ws.send(`X-RequestId:${requestId()}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${ts}Z\r\nPath:ssml\r\n\r\n${ssml}`);
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') return; // turn.start / response 文本帧忽略
      // 二进制帧：头部长度存在前 2 字节大端，头部含 Path:audio / Path:turn.end
      const view = new DataView(ev.data);
      const headerLen = view.getUint16(0);
      const header = new TextDecoder().decode(new Uint8Array(ev.data, 2, headerLen));
      if (header.includes('Path:audio')) {
        chunks.push(new Uint8Array(ev.data, 2 + headerLen));
      } else if (header.includes('Path:turn.end')) {
        finish(() => {
          if (!chunks.length) { reject(new Error('edge 无音频返回')); return; }
          resolve(new Blob(chunks, { type: 'audio/mp3' }));
        });
      }
    };
    ws.onerror = () => finish(() => reject(new Error('edge 连接失败')));
    ws.onclose = () => {
      clearTimeout(timer);
      if (!chunks.length) reject(new Error('edge 连接关闭'));
    };
  });
}

/** 切分文本：单段 ≤160 字（按句/逗号切） */
function splitText(text) {
  const rough = String(text).split(/(?<=[。！？!?；;\n])/).map(s => s.trim()).filter(Boolean);
  const out = [];
  for (const seg of rough) {
    if (seg.length <= 160) { out.push(seg); continue; }
    let cur = '';
    for (const piece of seg.split(/(?<=[，,、])/)) {
      if ((cur + piece).length > 160 && cur) { out.push(cur); cur = piece; }
      else cur += piece;
    }
    if (cur) out.push(cur);
  }
  return out.length ? out : [String(text)];
}

// 熔断器：连续失败 2 次后 60 秒内快速失败（大陆无代理环境避免每次播报都干等握手超时）
let failCount = 0;
let breakerUntil = 0;

/**
 * 合成并播放：成功 resolve(true)，失败 reject（由调用方降级到下一档引擎）
 * playBlob 由 tts.js 注入，避免循环依赖
 */
export async function edgeSpeak(text, { rate = 1.0, playBlob }) {
  if (Date.now() < breakerUntil) throw new Error('edge 熔断中（连续失败，稍后自动恢复）');
  try {
    const chunks = splitText(text);
    for (const chunk of chunks) {
      const blob = await synthChunk(chunk, edgeVoice, rate);
      await playBlob(blob);
    }
    failCount = 0;
    return true;
  } catch (e) {
    failCount++;
    if (failCount >= 2) breakerUntil = Date.now() + 60000;
    throw e;
  }
}
