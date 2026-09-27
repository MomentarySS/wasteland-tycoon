// 开局配置面板
import { SHORT, BRAND_MARK_HTML } from './config.js';
import { startGame } from './game.js';
import { getDifficultyPreset } from './difficulty.js';
import {
  WASTELAND_EMOJI, slotAvatarHTML, getSlotAvatarStore
} from './view-core.js';
import {
  getVoiceSource, setVoiceSource, MINIMAX_VOICES, getMinimaxVoice, setMinimaxVoice,
  MIMO_VOICES, getMimoVoice, setMimoVoice, onlineKeyStatus, saveOnlineKey, clearOnlineKey
} from './tts.js';
import { showLegacyShop } from './view-legacy.js';

export function buildSetup() {
  const setup = document.getElementById('setup');
  const slotAvatars = getSlotAvatarStore();
  slotAvatars.length = 0;
  let cards = '';
  for (let i = 0; i < 4; i++) {
    const def = i === 0 ? 'human' : (i === 1 ? 'ai' : 'off');
    const emoBtns = WASTELAND_EMOJI.map(e => '<button type="button" class="avEmoji" data-em="' + e + '">' + e + '</button>').join('');
    cards += '<div class="slotCard" data-i="' + i + '">'
      + '<div class="scTop">'
      +   '<span class="slotHead"><span id="pva' + i + '">' + slotAvatarHTML(i) + '</span> 玩家 ' + SHORT[i] + '</span>'
      +   '<select id="slot' + i + '" class="scSlot">'
      +     '<option value="human"' + (def === 'human' ? ' selected' : '') + '>人类</option>'
      +     '<option value="ai"' + (def === 'ai' ? ' selected' : '') + '>电脑</option>'
      +     '<option value="off"' + (def === 'off' ? ' selected' : '') + '>关闭</option>'
      +   '</select>'
      + '</div>'
      + '<div class="scNameRow">'
      +   '<span class="scLbl">名称</span>'
      +   '<input id="name' + i + '" class="nameIn" placeholder="默认 玩家' + SHORT[i] + '" maxlength="8">'
      + '</div>'
      + '<div class="avRow">'
      +   '<span class="avPrev">头像</span>'
      +   '<div class="avEmojis">' + emoBtns + '</div>'
      +   '<label class="avUpload" title="上传图片作为头像">📷 上传<input type="file" accept="image/*" hidden></label>'
      + '</div>'
      + '</div>';
  }

  const curSrc = getVoiceSource();
  const curVoice = getMinimaxVoice();
  const curMimoVoice = getMimoVoice();
  const voiceOpts = MINIMAX_VOICES.map((v) =>
    '<option value="' + v.id.replace(/"/g, '&quot;') + '"' + (v.id === curVoice ? ' selected' : '') + '>' + v.label + '</option>'
  ).join('');
  const mimoVoiceOpts = MIMO_VOICES.map((v) =>
    '<option value="' + v.id.replace(/"/g, '&quot;') + '"' + (v.id === curMimoVoice ? ' selected' : '') + '>' + v.label + '</option>'
  ).join('');

  setup.innerHTML =
    '<div class="setupTop">'
    + '<h2>' + BRAND_MARK_HTML + ' 配置你的废土</h2>'
    + '<div class="setupMode"><span>模式</span>'
    +   '<select id="mode">'
    +     '<option value="versus" selected>对抗（大富翁）</option>'
    +     '<option value="campaign">单人闯关</option>'
    +     '<option value="coop">合作闯关（1人+1AI）</option>'
    +     '<option value="survival">生存模式（无限衰减）</option>'
    +     '<option value="legacy">遗产模式（肉鸽+传承）</option>'
    +   '</select></div>'
    +   '<div class="setupMode"><span>遗产</span>'
    +     '<button type="button" class="alt" id="legacyShopBtn" style="padding:4px 10px;font-size:12px;">🏪 商店</button>'
    +   '</div>'
    + '</div>'
    + '<div class="setupBody">'
    +   '<div class="setupPlayers" id="slots">' + cards + '</div>'
    +   '<div class="setupOpts">'
    +     '<h3>// 规则配置</h3>'
    +     '<div class="optRow"><span>难度</span><select id="difficulty">'
    +       '<option value="easy">简单</option>'
    +       '<option value="standard" selected>标准</option>'
    +       '<option value="nightmare">噩梦</option>'
    +     '</select></div>'
    +     '<div class="optRow dim edgeNote" id="diffHint">标准：平衡对抗与闯关体验</div>'
    +     '<div class="optRow"><span>初始瓶盖</span><input id="startCaps" type="number" value="1500"></div>'
    +     '<div class="optRow"><span>经过据点补给</span><input id="salary" type="number" value="200"></div>'
    +     '<div class="optRow"><span>目标净身家胜利</span><input id="target" type="number" value="3000"></div>'
    +     '<div class="optRow"><span>随机棋盘</span><select id="randBoard"><option value="on" selected>开(每局不同)</option><option value="off">关(固定布局)</option></select></div>'
    +     '<div class="optRow"><span>语音播报</span><select id="ttsOn"><option value="on" selected>开</option><option value="off">关</option></select></div>'
    +     '<div class="optRow"><span>播报语速</span><select id="ttsRate"><option value="0.9">慢</option><option value="1.05" selected>正常</option><option value="1.5">快</option></select></div>'
    +     '<div class="optRow"><span>语音来源</span><select id="ttsSrc">'
    +       '<option value="minimax"' + (curSrc === 'minimax' ? ' selected' : '') + '>MiniMax 在线（全部播报）</option>'
    +       '<option value="mimo"' + (curSrc === 'mimo' ? ' selected' : '') + '>小米 MiMo 在线（全部播报）</option>'
    +       '<option value="voice"' + (curSrc === 'voice' ? ' selected' : '') + '>仅 MiniMax 预录</option>'
    +     '</select></div>'
    +     '<div class="optRow" id="minimaxVoiceRow"><span>MiniMax 音色</span><select id="ttsVoice">' + voiceOpts + '</select></div>'
    +     '<div class="optRow" id="mimoVoiceRow"><span>MiMo 音色</span><select id="mimoVoice">' + mimoVoiceOpts + '</select></div>'
    +     '<div class="ttsKeyEntry" id="ttsKeyEntry">'
    +       '<button type="button" class="alt ttsKeyToggle" id="ttsKeyToggle">🔑 设置在线语音 API Key</button>'
    +       '<div class="ttsKeyPanel" id="ttsKeyPanel" hidden>'
    +         '<label class="ttsKeyLabel" for="ttsApiKey" id="ttsKeyLabel">MiniMax API Key</label>'
    +         '<a class="ttsKeyDocs" id="ttsKeyDocs" href="https://platform.minimax.cn/docs/guides/speech-t2a-websocket" target="_blank" rel="noreferrer">打开服务商官方接口与 Key 页面 ↗</a>'
    +         '<input id="ttsApiKey" type="password" autocomplete="off" spellcheck="false" placeholder="粘贴 API Key；保存后输入框会清空">'
    +         '<div class="ttsKeyActions"><button type="button" id="ttsKeySave">保存并启用在线语音</button><button type="button" class="alt" id="ttsKeyClear">清除本机 Key</button></div>'
    +         '<span class="ttsKeyStatus" id="ttsKeyStatus" role="status">Key 使用 Windows 安全存储保存在当前用户的应用数据目录。</span>'
    +       '</div>'
    +     '</div>'
    +     '<div class="edgeNote dim" id="ttsVoiceHint">在线语音换音色后点顶部「测音」试听；选择会保存在本机。</div>'
    +   '</div>'
    + '</div>'
    + '<button class="startBtn" id="startBtn">⚙ 启 动</button>';

  setup.querySelectorAll('.slotCard').forEach(card => {
    const i = +card.dataset.i;
    card.querySelectorAll('.avEmoji').forEach(btn => {
      btn.onclick = () => {
        slotAvatars[i] = btn.dataset.em;
        const prev = document.getElementById('pva' + i);
        if (prev) prev.innerHTML = slotAvatarHTML(i);
        card.querySelectorAll('.avEmoji').forEach(b => b.classList.toggle('sel', b === btn));
      };
    });
    const fileInput = card.querySelector('input[type=file]');
    if (fileInput) fileInput.onchange = (e) => {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      // 小图直接用原图；大图缩到 256px JPEG，防止 dataURL 撑爆 localStorage 导致存档失败
      if (f.size <= 100 * 1024) {
        const rd = new FileReader();
        rd.onload = () => {
          slotAvatars[i] = rd.result;
          const prev = document.getElementById('pva' + i);
          if (prev) prev.innerHTML = slotAvatarHTML(i);
          card.querySelectorAll('.avEmoji').forEach(b => b.classList.remove('sel'));
        };
        rd.readAsDataURL(f);
        return;
      }
      const img = new Image();
      const url = URL.createObjectURL(f);
      img.onload = () => {
        try {
          const MAX = 256;
          const scale = Math.min(1, MAX / Math.max(img.width, img.height));
          const cv = document.createElement('canvas');
          cv.width = Math.max(1, Math.round(img.width * scale));
          cv.height = Math.max(1, Math.round(img.height * scale));
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          slotAvatars[i] = cv.toDataURL('image/jpeg', 0.85);
          const prev = document.getElementById('pva' + i);
          if (prev) prev.innerHTML = slotAvatarHTML(i);
          card.querySelectorAll('.avEmoji').forEach(b => b.classList.remove('sel'));
        } catch (err) { console.warn('头像压缩失败', err); }
        URL.revokeObjectURL(url);
      };
      img.onerror = () => URL.revokeObjectURL(url);
      img.src = url;
    };
  });
  const sb = document.getElementById('startBtn');
  if (sb) sb.onclick = startGame;
  // wireTopButtons 先于 buildSetup 执行，商店按钮在此处生成后须在此补绑
  const legacyBtn = document.getElementById('legacyShopBtn');
  if (legacyBtn) legacyBtn.onclick = () => showLegacyShop();

  const ttsSrcSel = document.getElementById('ttsSrc');
  const keyPanel = document.getElementById('ttsKeyPanel');
  const keyLabel = document.getElementById('ttsKeyLabel');
  const keyDocs = document.getElementById('ttsKeyDocs');
  const keyToggle = document.getElementById('ttsKeyToggle');
  const keyStatus = document.getElementById('ttsKeyStatus');
  const minimaxVoiceRow = document.getElementById('minimaxVoiceRow');
  const mimoVoiceRow = document.getElementById('mimoVoiceRow');
  const voiceHint = document.getElementById('ttsVoiceHint');
  const updateTtsProviderControls = () => {
    const provider = ttsSrcSel ? ttsSrcSel.value : curSrc;
    const online = provider === 'minimax' || provider === 'mimo';
    const isMimo = provider === 'mimo';
    const keyEntry = document.getElementById('ttsKeyEntry');
    if (keyEntry) keyEntry.hidden = !online;
    if (minimaxVoiceRow) minimaxVoiceRow.hidden = !online || isMimo;
    if (mimoVoiceRow) mimoVoiceRow.hidden = !isMimo;
    if (keyLabel) keyLabel.textContent = isMimo ? '小米 MiMo API Key' : 'MiniMax API Key';
    if (keyDocs) keyDocs.href = isMimo
      ? 'https://mimo.mi.com/models/zh-CN/mimo-v2.5-tts'
      : 'https://platform.minimax.cn/docs/guides/speech-t2a-websocket';
    if (keyToggle) keyToggle.textContent = isMimo ? '🔑 设置小米 MiMo API Key' : '🔑 设置 MiniMax API Key';
    if (voiceHint) voiceHint.textContent = isMimo
      ? '使用 MiMo-V2.5-TTS；支持 API Key 和 Token Plan Key，音色可选苏打、白桦、冰糖、茉莉。点顶部「测音」试听。'
      : 'MiniMax 在线音色可在上方选择；点顶部「测音」试听。预录模式只播放包内已有的固定语句。';
  };

  async function refreshKeyStatus() {
    if (!keyStatus || !ttsSrcSel || (ttsSrcSel.value !== 'minimax' && ttsSrcSel.value !== 'mimo')) return;
    keyStatus.textContent = '正在读取本机 Key 状态…';
    const status = await onlineKeyStatus(ttsSrcSel.value);
    keyStatus.textContent = !status.available
      ? '请在 Windows 桌面版中配置 Key。'
      : status.ok ? '已配置 Key；可点顶部「测音」验证连接。' : '尚未配置 Key。';
  }

  if (ttsSrcSel) {
    ttsSrcSel.onchange = () => {
      setVoiceSource(ttsSrcSel.value);
      updateTtsProviderControls();
      if (keyPanel && !keyPanel.hidden) refreshKeyStatus();
    };
    setVoiceSource(ttsSrcSel.value);
  }
  const ttsVoiceSel = document.getElementById('ttsVoice');
  if (ttsVoiceSel) {
    ttsVoiceSel.onchange = () => setMinimaxVoice(ttsVoiceSel.value);
    setMinimaxVoice(ttsVoiceSel.value);
  }
  const mimoVoiceSel = document.getElementById('mimoVoice');
  if (mimoVoiceSel) {
    mimoVoiceSel.onchange = () => setMimoVoice(mimoVoiceSel.value);
    setMimoVoice(mimoVoiceSel.value);
  }
  if (keyToggle && keyPanel) keyToggle.onclick = async () => {
    keyPanel.hidden = !keyPanel.hidden;
    if (!keyPanel.hidden) await refreshKeyStatus();
  };
  const keyInput = document.getElementById('ttsApiKey');
  const saveKeyBtn = document.getElementById('ttsKeySave');
  if (saveKeyBtn && keyInput && keyStatus) saveKeyBtn.onclick = async () => {
    const key = keyInput.value.trim();
    if (!key) { keyStatus.textContent = '请先输入 API Key。'; keyInput.focus(); return; }
    saveKeyBtn.disabled = true;
    keyStatus.textContent = '正在安全保存并初始化服务…';
    const provider = ttsSrcSel ? ttsSrcSel.value : 'minimax';
    let result;
    try { result = await saveOnlineKey(provider, key); }
    catch (_) { result = { ok: false, error: '保存失败，请检查桌面客户端状态。' }; }
    finally { saveKeyBtn.disabled = false; }
    keyInput.value = '';
    keyStatus.textContent = result.ok
      ? 'Key 已保存在本机；点顶部「测音」验证 API Key 和播报。'
      : (result.error || '保存失败，请重试。');
  };
  const clearKeyBtn = document.getElementById('ttsKeyClear');
  if (clearKeyBtn && keyStatus) clearKeyBtn.onclick = async () => {
    clearKeyBtn.disabled = true;
    keyStatus.textContent = '正在清除本机 Key…';
    const provider = ttsSrcSel ? ttsSrcSel.value : 'minimax';
    let result;
    try { result = await clearOnlineKey(provider); }
    catch (_) { result = { ok: false, error: '清除失败，请检查桌面客户端状态。' }; }
    finally { clearKeyBtn.disabled = false; }
    keyStatus.textContent = result.ok ? '本机保存的 Key 已清除。' : (result.error || 'Key 已清除；当前未配置在线 Key。');
  };
  updateTtsProviderControls();

  function applyDifficultyForm(id) {
    const p = getDifficultyPreset(id);
    const caps = document.getElementById('startCaps');
    const sal = document.getElementById('salary');
    const tgt = document.getElementById('target');
    if (caps) caps.value = String(p.startCaps);
    if (sal) sal.value = String(p.salary);
    if (tgt) tgt.value = String(p.targetWealth);
    const hint = document.getElementById('diffHint');
    if (hint) {
      const hints = {
        easy: '简单：更多初始盖与补给，AI 较保守，税率降低',
        standard: '标准：平衡对抗与闯关体验',
        nightmare: '噩梦：开局更紧、税率更高，AI 更激进',
      };
      hint.textContent = hints[id] || hints.standard;
    }
  }

  const diffSel = document.getElementById('difficulty');
  if (diffSel) {
    diffSel.onchange = () => applyDifficultyForm(diffSel.value);
    applyDifficultyForm(diffSel.value);
  }
}

/** 从配置面板读取并持久化 TTS 设置（供 game.js 等调用，避免重复逻辑） */
export function applyTtsSetupFromForm() {
  const ttsSrc = document.getElementById('ttsSrc');
  if (ttsSrc) setVoiceSource(ttsSrc.value);
  const ttsVoice = document.getElementById('ttsVoice');
  if (ttsVoice) setMinimaxVoice(ttsVoice.value);
}
