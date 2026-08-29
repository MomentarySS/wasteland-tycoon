// 开局配置面板
import { SHORT, BRAND_MARK_HTML } from './config.js';
import { startGame } from './game.js';
import { getDifficultyPreset } from './difficulty.js';
import {
  WASTELAND_EMOJI, slotAvatarHTML, getSlotAvatarStore
} from './view-core.js';
import {
  getVoiceSource, getStepApiKey, getStepVoice, getStepInstruction,
  setStepApiKey, setStepVoice, setStepInstruction, setVoiceSource,
  STEP_VOICES
} from './tts.js';
import { escapeHtml } from './view-util.js';
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
  const curVoice = getStepVoice();
  const voiceOpts = STEP_VOICES.map((v) =>
    '<option value="' + escapeHtml(v.id) + '"' + (v.id === curVoice ? ' selected' : '') + '>' + escapeHtml(v.label) + '</option>'
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
    +       '<option value="auto"' + (curSrc === 'auto' ? ' selected' : '') + '>自动(在线优先)</option>'
    +       '<option value="step"' + (curSrc === 'step' ? ' selected' : '') + '>阶跃在线</option>'
    +     '</select></div>'
    +     '<div id="ttsPanelStep" class="ttsSubPanel">'
    +       '<div class="ttsSubHead">// 阶跃在线设置</div>'
    +       '<div class="optRow col2"><span>阶跃 API Key</span><input id="stepApiKey" class="nameIn" type="password" autocomplete="off" placeholder="Step Plan Key，仅存本机浏览器"></div>'
    +       '<div class="optRow"><span>阶跃音色</span><select id="stepVoice">' + voiceOpts + '</select></div>'
    +       '<div class="optRow col2"><span>播报风格</span><input id="stepInstruction" class="nameIn" placeholder="废土电台播报员…" maxlength="200"></div>'
    +     '</div>'
    +     '<div class="edgeNote dim" id="ttsPanelAutoNote">自动模式：有 Key → 阶跃在线；无 Key → 系统语音（即时，无需下载）。Key 仅存本机，请勿公开部署。</div>'
    +   '</div>'
    + '</div>'
    + '<button class="startBtn" id="startBtn">⚙ 启 动</button>';

  const keyIn = document.getElementById('stepApiKey');
  if (keyIn) keyIn.value = getStepApiKey();
  const instrIn = document.getElementById('stepInstruction');
  if (instrIn) instrIn.value = getStepInstruction();

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

  function updateTtsPanels() {
    const src = document.getElementById('ttsSrc') ? document.getElementById('ttsSrc').value : 'auto';
    setVoiceSource(src);
    const stepPanel = document.getElementById('ttsPanelStep');
    const autoNote = document.getElementById('ttsPanelAutoNote');
    if (stepPanel) stepPanel.style.display = (src === 'step' || src === 'auto') ? '' : 'none';
    if (autoNote) autoNote.style.display = src === 'auto' ? '' : 'none';
  }

  const ttsSrcSel = document.getElementById('ttsSrc');
  if (ttsSrcSel) {
    ttsSrcSel.onchange = updateTtsPanels;
    updateTtsPanels();
  }

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
  const keyIn = document.getElementById('stepApiKey');
  if (keyIn) setStepApiKey(keyIn.value.trim());
  const voiceSel = document.getElementById('stepVoice');
  if (voiceSel) setStepVoice(voiceSel.value);
  const instrIn = document.getElementById('stepInstruction');
  if (instrIn) setStepInstruction(instrIn.value.trim());
}
