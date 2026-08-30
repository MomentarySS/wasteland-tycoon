// 视图层入口：聚合子模块，保持对外 API 不变
export {
  WASTELAND_EMOJI, avatarHTML, slotAvatarHTML, getSlotAvatars,
  fitBoard, log, clearLog, setDice, setActionsHTML,
  render, renderPlayers, buildTokens, placeToken, updateTilePreview,
  setActiveTile, isBoardTiltEnabled, setBoardTilt, applyBoardTilt,
  isTileArtEnabled, setTileArt, applyTileArt, repositionAllTokens
} from './view-core.js';

export { buildSetup } from './view-setup.js';
export { renderManage, proposeTrade, applyTrade } from './view-manage.js';
export { saveGame, loadGame } from './view-save.js';
export {
  openModal, closeModal, showWin, showNukeWin, showNukeLaunchConfirm,
  showMission, showBlackMarket, showSpeedDieChoice, showHand,
  showRadiation, showBunker,
  showChapterIntro, showCampaignEnding
} from './view-modal.js';

import { initView as _initView } from './view-core.js';
import { initModalRefs } from './view-modal.js';
import { buildSetup } from './view-setup.js';
import { saveGame, loadGame } from './view-save.js';
import { cancelTts, setTtsEnabled, unlockTts, preloadTTS, isTtsEnabled, ttsEngineStatus, testTts, updateTtsDebugPanel } from './tts.js';
import { toggleMute } from './audio.js';
import { restart } from './game.js';
import { showLegacyShop } from './view-legacy.js';

let ttsStatusTimer = null;

export function initView() {
  initModalRefs();
  _initView();
}

export function showSetupScreen() {
  const overlay = document.getElementById('overlay');
  const win = document.getElementById('win');
  if (overlay) overlay.style.display = 'flex';
  if (win) win.style.display = 'none';
  cancelTts();
  buildSetup();
}

function updateTtsStatus() {
  try {
    const el = document.getElementById('ttsStatus');
    if (!el) return;
    const map = {
      disabled: '🔇 已关',
      capacitor: '✓ 原生语音',
      'capacitor-ready': '✓ 原生语音就绪',
      step: '✓ 阶跃在线',
      edge: '✓ Edge语音',
      'edge-ready': '✓ Edge在线',
      'step-ready': '✓ 阶跃就绪',
      browser: '✓ 系统语音',
      'browser-ready': '✓ 系统语音',
      'no-key': '⚠ 未填 Key',
      pending: '待加载…',
      none: '无语音'
    };
    const status = ttsEngineStatus();
    el.textContent = map[status] || '';
    console.warn('[UI] updateTtsStatus:', status, '=>', el.textContent);
    try { updateTtsDebugPanel(); } catch (_) {}
  } catch (e) {
    console.warn('[UI] updateTtsStatus 异常:', e && e.message);
  }
}

export function wireTopButtons() {
  if (ttsStatusTimer) {
    clearInterval(ttsStatusTimer);
    ttsStatusTimer = null;
  }
  const mb = document.getElementById('muteBtn'); if (mb) mb.onclick = toggleMute;
  const tb = document.getElementById('ttsBtn');
  if (tb) {
    tb.textContent = isTtsEnabled() ? '🗣 播报:开' : '🔇 播报:关';
    tb.onclick = () => {
      const on = !isTtsEnabled();
      setTtsEnabled(on);
      if (on) { unlockTts(); preloadTTS().then(updateTtsStatus); }
      tb.textContent = on ? '🗣 播报:开' : '🔇 播报:关';
      updateTtsStatus();
    };
  }
  const testBtn = document.getElementById('testTtsBtn');
  if (testBtn && typeof testTts === 'function') {
    console.warn('[UI] 测音按钮已绑定');
    testBtn.onclick = async () => {
      console.warn('[UI] 测音按钮被点击');
      testBtn.disabled = true;
      testBtn.textContent = ' 🔊 测试中...';
      try {
        const engine = await testTts();
        console.warn('[UI] testTts 完成，引擎:', engine);
        updateTtsStatus();
      } catch (e) {
        console.warn('[UI] testTts 异常:', e && e.message);
      }
      testBtn.disabled = false;
      testBtn.textContent = '🔊 测音';
    };
  } else {
    console.warn('[UI] 测音按钮未找到或 testTts 不可用');
  }
  updateTtsStatus();
  ttsStatusTimer = setInterval(updateTtsStatus, 3000);
  const sb = document.getElementById('saveBtn'); if (sb) sb.onclick = saveGame;
  const lb = document.getElementById('loadBtn'); if (lb) lb.onclick = loadGame;
  const rb = document.getElementById('restartBtn'); if (rb) rb.onclick = restart;
  const wr = document.getElementById('winRestart'); if (wr) wr.onclick = restart;
  const ls = document.getElementById('legacyShopBtn');
  if (ls) { ls.onclick = () => showLegacyShop(); }
}
