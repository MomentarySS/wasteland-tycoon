// TTS 试听页逻辑：sherpa-onnx 预编译 WASM 包加载 + Worker 生成 + 切片播放 + RTF 统计
// 与游戏本体无关；模型包经 npm run download:tts-lab 安装到 vendor/tts-lab/<engine>/

const ENGINES = [
  { id: 'zipvoice', label: 'ZipVoice 中英 int8（克隆模型，需参考音频）', base: '/vendor/tts-lab/zipvoice/' },
  { id: 'matcha', label: 'Matcha 中文 Baker（免克隆固定音色）', base: '/vendor/tts-lab/matcha/' },
  { id: 'kokoro', label: 'Kokoro v1.1-zh int8', base: '/vendor/tts-lab/kokoro/' },
];

const PRESETS = [
  { label: '战报短句', text: '废土大亨：末世大富翁。玩家甲掷出 11 点，占领了莫诺加矿洞。' },
  { label: '含数字', text: '第 3 章节达成！剩余瓶盖 1520 盖，净资产 3000 盖，距离目标还差 25%。' },
  { label: '中英混合', text: '玩家乙使用了 Plunder 卡，从 Player A 手里抢走 100 盖。Radio: Alpha Bravo Charlie，收到请回答。' },
  {
    label: '长文本（切片）',
    text: '废土的黎明被沙尘暴笼罩着。幸存者们从避难所里陆续走出，检查着昨夜架设的太阳能板。' +
      '莫诺加矿洞的辐射读数再次升高，斥候建议绕开东边的裂谷。与此同时，黑市传来消息：' +
      '一批罕见的高纯度瓶盖正在流通，价格比上周翻了一倍还多。国会掩体的谈判代表第三天没有回应，' +
      '各方都在猜测约定的交易是否还会继续。夜幕降临之前，每一块电池、每一滴水，都可能决定下一个倒下的是谁。',
  },
];

// ---------- 基础 UI ----------
const $ = (id) => document.getElementById(id);
const logEl = $('log');
function log(msg, cls) {
  const line = document.createElement('div');
  if (cls) line.className = cls;
  line.textContent = msg;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

// WASM SIMD 支持检测（官方 wasm 构建要求）
const SIMD_OK = (() => {
  try {
    return WebAssembly.validate(new Uint8Array([
      0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
    ]));
  } catch (_) { return false; }
})();

// ---------- 引擎可用性探测 ----------
async function detectEngines() {
  const sel = $('engine');
  sel.innerHTML = '';
  const origin = location.origin;
  let any = false;
  for (const eng of ENGINES) {
    eng.base = origin + eng.base;   // blob Worker 内 importScripts 需要完整 URL
    let ok = false;
    try {
      // 注意：serve.mjs 对未知路径回退 200 的 index.html，必须校验 content-type 排除误判
      const resp = await fetch(eng.base + 'sherpa-onnx-wasm-main-tts.data', { method: 'HEAD' });
      const ct = (resp.headers.get('content-type') || '');
      ok = resp.ok && !ct.includes('text/html');
    } catch (_) { ok = false; }
    if (ok) {
      const opt = document.createElement('option');
      opt.value = eng.id;
      opt.textContent = eng.label;
      sel.appendChild(opt);
      any = true;
      log(`✓ 引擎可用：${eng.label}`, 'ok');
    } else {
      log(`✗ 未安装：${eng.label}（npm run download:tts-lab）`, 'warn');
    }
  }
  if (!any) {
    log('没有任何引擎。先运行 npm run download:tts-lab 下载模型包，再刷新本页。', 'bad');
    $('initBtn').disabled = true;
  }
}

// ---------- Worker：直接使用官方包自带的 module worker（自初始化 + ES 相对导入） ----------
// 消息协议（vendor 包内 sherpa-onnx-tts.worker.js）：
//   收 {type:'sherpa-onnx-tts-progress', status} / {type:'sherpa-onnx-tts-ready', numSpeakers}
//   收 {type:'sherpa-onnx-tts-result', samples, sampleRate} / {type:'error', message}
//   发 {type:'generate', text, sid, speed}
let worker = null;
let curEngineBase = null;

function initEngine(base) {
  return new Promise((resolve, reject) => {
    if (worker) worker.terminate();
    curEngineBase = base;
    // module worker：相对 import 以 worker 脚本自身 URL 为基准，无需自定义 locateFile
    worker = new Worker(base + 'sherpa-onnx-tts.worker.js', { type: 'module' });
    worker.addEventListener('message', onMsg);
    worker.addEventListener('error', (e) => reject(new Error('worker: ' + (e.message || '加载失败'))));
    function onMsg(e) {
      const d = e.data || {};
      if (d.type === 'sherpa-onnx-tts-progress') {
        const s = String(d.status || '');
        if (s && !/^\d+%$/.test(s)) log('[loader] ' + s);
      } else if (d.type === 'sherpa-onnx-tts-ready') {
        worker.removeEventListener('message', onMsg);
        resolve({ numSpeakers: d.numSpeakers, modelType: d.modelType });
      } else if (d.type === 'error') {
        worker.removeEventListener('message', onMsg);
        reject(new Error(d.message));
      }
    }
  });
}

function generateInWorker(text, sid, speed, genConfig) {
  return new Promise((resolve, reject) => {
    const onMsg = (e) => {
      const d = e.data || {};
      if (d.type === 'sherpa-onnx-tts-result') {
        worker.removeEventListener('message', onMsg);
        resolve({ samples: d.samples, sampleRate: d.sampleRate, genMs: Date.now() - t0 });
      } else if (d.type === 'error') {
        worker.removeEventListener('message', onMsg);
        reject(new Error(d.message));
      }
    };
    const t0 = Date.now();
    worker.addEventListener('message', onMsg);
    if (genConfig) {
      // 克隆模型：传参考音频副本（transfer 会 detach，每次传新拷贝）
      const copy = new Float32Array(genConfig.referenceAudio);
      worker.postMessage({ type: 'generateWithConfig', text, genConfig: { ...genConfig, referenceAudio: copy } }, [copy.buffer]);
    } else {
      worker.postMessage({ type: 'generate', text, sid, speed });
    }
  });
}

// ---------- 播放 ----------
let audioCtx = null;
let stopFlag = false;

function playBuffer(samples, sampleRate) {
  return new Promise((resolve) => {
    if (!audioCtx || audioCtx.sampleRate !== sampleRate) {
      if (audioCtx) audioCtx.close();
      audioCtx = new AudioContext({ sampleRate });
    }
    const buf = audioCtx.createBuffer(1, samples.length, sampleRate);
    buf.getChannelData(0).set(samples);
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    src.connect(audioCtx.destination);
    src.onended = () => resolve();
    src.start();
    stopFlag && resolve();
  });
}

// ---------- WAV 导出 ----------
function toWav(samples, sampleRate) {
  const n = samples.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const ws = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); ws(8, 'WAVE');
  ws(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  ws(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

// ---------- 切片 ----------
function splitSentences(text) {
  // 按中英句末标点/换行切分；单句过长（>80 字）再按逗号切
  const rough = text.split(/(?<=[。！？!?；;\n])/).map(s => s.trim()).filter(Boolean);
  const out = [];
  for (const seg of rough) {
    if (seg.length <= 80) { out.push(seg); continue; }
    let cur = '';
    for (const piece of seg.split(/(?<=[，,、])/)) {
      if ((cur + piece).length > 80 && cur) { out.push(cur); cur = piece; }
      else cur += piece;
    }
    if (cur) out.push(cur);
  }
  return out.length ? out : [text];
}

// ---------- 主流程 ----------
let ready = false;
let engineInfo = null;
let lastAudio = { samples: null, sampleRate: 24000 };
let genQueue = Promise.resolve();
// ZipVoice（modelType=4）是零样本克隆模型：需要参考音频 + 文字稿，走 generateWithConfig
let refAudio = null;   // { samples: Float32Array, sampleRate }

async function ensureInit() {
  if (ready) return;
  const base = ENGINES.find(e => e.id === $('engine').value)?.base;
  if (!base) throw new Error('请先选择引擎');
  log(`初始化引擎（加载 WASM + 模型，可能需要较长时间）…`, 'warn');
  engineInfo = await initEngine(base);
  curEngineBase = base;
  ready = true;
  $('spkInfo').textContent = `共 ${engineInfo.numSpeakers} 个音色 · modelType ${engineInfo.modelType}`;
  $('sid').max = String(engineInfo.numSpeakers - 1);
  // 克隆模型需要参考音频，显示上传区
  $('refRow').style.display = engineInfo.modelType === 4 ? 'flex' : 'none';
  log(`✓ 引擎就绪：${engineInfo.numSpeakers} 音色 @ modelType ${engineInfo.modelType}`, 'ok');
}

async function generateAndPlay() {
  if (!SIMD_OK) { log('浏览器不支持 WASM SIMD，无法运行。', 'bad'); return; }
  try {
    await ensureInit();
  } catch (e) {
    log('初始化失败：' + e.message, 'bad');
    return;
  }
  const text = $('text').value.trim();
  if (!text) return;
  const sid = Math.max(0, parseInt($('sid').value, 10) || 0);
  const speed = parseFloat($('speed').value) || 1;
  // 克隆模型（ZipVoice）：必须有参考音频 + 文字稿
  let genConfig = null;
  if (engineInfo.modelType === 4) {
    if (!refAudio) { log('克隆模型需要先上传参考音频（3~10 秒 wav）并填写其文字稿', 'bad'); return; }
    const refText = ($('refText').value || '').trim();
    if (!refText) { log('请填写参考音频的文字稿（它说了什么）', 'bad'); return; }
    genConfig = {
      speed,
      referenceAudio: refAudio.samples,
      referenceSampleRate: refAudio.sampleRate,
      numSteps: 4,
      referenceText: refText,
      extra: { min_char_in_sentence: 10 },
    };
  }
  const chunks = splitSentences(text);
  log(`切片：${chunks.length} 段 · ${engineInfo.modelType === 4 ? '克隆模式' : '音色 ' + sid} · 语速 ${speed}`);
  $('genBtn').disabled = true;
  $('stopBtn').disabled = false;
  stopFlag = false;
  $('rtTable').tBodies[0].innerHTML = '';
  const all = [];
  for (let i = 0; i < chunks.length && !stopFlag; i++) {
    const chunk = chunks[i];
    try {
      const res = await generateInWorker(chunk, sid, speed, genConfig);
      const sec = res.samples.length / res.sampleRate;
      const rtf = res.genMs / 1000 / sec;
      lastAudio = { samples: res.samples, sampleRate: res.sampleRate };
      all.push(res.samples);
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${i + 1}</td><td>${chunk.length}</td><td>${(res.genMs / 1000).toFixed(2)}s</td><td>${sec.toFixed(2)}s</td><td class="${rtf < 1 ? 'ok' : 'bad'}">${rtf.toFixed(2)}</td>`;
      $('rtTable').tBodies[0].appendChild(tr);
      log(`#${i + 1} 生成完成（RTF ${rtf.toFixed(2)}），播放中…`);
      genQueue = genQueue.then(() => stopFlag ? undefined : playBuffer(res.samples, res.sampleRate));
      await genQueue;
    } catch (e) {
      log(`#${i + 1} 生成失败：${e.message}`, 'bad');
      break;
    }
  }
  $('wavBtn').disabled = !all.length;
  $('genBtn').disabled = false;
  $('stopBtn').disabled = true;
  log(stopFlag ? '已停止。' : '全部完成。', 'ok');
}

// ---------- 接线 ----------
function initUI() {
  $('simd').innerHTML = SIMD_OK
    ? '<span class="ok">✓ WASM SIMD</span>'
    : '<span class="bad">✗ 浏览器不支持 WASM SIMD</span>';
  const presets = $('presets');
  PRESETS.forEach(p => {
    const b = document.createElement('button');
    b.className = 'alt sm';
    b.textContent = p.label;
    b.onclick = () => { $('text').value = p.text; };
    presets.appendChild(b);
  });
  $('speed').oninput = () => { $('spdVal').textContent = parseFloat($('speed').value).toFixed(1); };
  $('refFile').onchange = async () => {
    const f = $('refFile').files[0];
    if (!f) return;
    try {
      const buf = await f.arrayBuffer();
      const ac = new AudioContext();
      const decoded = await ac.decodeAudioData(buf);
      ac.close();
      refAudio = { samples: decoded.getChannelData(0), sampleRate: decoded.sampleRate };
      $('refInfo').textContent = `✓ ${(decoded.duration).toFixed(1)}s @ ${decoded.sampleRate}Hz`;
      log(`参考音频已载入：${f.name}（${decoded.duration.toFixed(1)}s）`, 'ok');
    } catch (e) {
      log('参考音频解析失败（请用 wav 格式）：' + e.message, 'bad');
    }
  };
  $('engine').onchange = () => {
    ready = false; engineInfo = null;
    $('spkInfo').textContent = '';
    log('引擎已切换，点「初始化引擎」加载新模型', 'warn');
  };
  $('initBtn').onclick = () => ensureInit().catch(e => log('初始化失败：' + e.message, 'bad'));
  $('genBtn').onclick = () => { genQueue = Promise.resolve(); generateAndPlay(); };
  $('stopBtn').onclick = () => { stopFlag = true; if (audioCtx) audioCtx.close(); };
  $('wavBtn').onclick = () => {
    if (!lastAudio.samples) return;
    const url = URL.createObjectURL(toWav(lastAudio.samples, lastAudio.sampleRate));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tts-lab.wav';
    a.click();
    URL.revokeObjectURL(url);
  };
  detectEngines();
}

initUI();
