// 全屏过场（cutscene）：核弹结局 / 大事件专用分镜序列
// 只做表现：分镜 + 剧情字幕打字机 + 转场淡出，不参与任何规则判定；
// 无 DOM 环境（node 测试 / mock）下整体降级为立即返回。
// 分镜数据（NUKE_SCENES）放 voice-lines.js：预录旁白按 sub 生成，运行时按同一份文案寻址。
import { sfx } from './audio.js';
import { ttsSpeakPrerecorded } from './tts.js';
import { NUKE_SCENES, cutsceneSpeakText } from './voice-lines.js';
import { DOM_READY, reducedMotion, sleep } from './fx-env.js';

const ENABLED = DOM_READY;

const RM = ENABLED && reducedMotion();

let layer = null;

function buildLayer() {
  layer = document.createElement('div');
  layer.id = 'cutscene';
  layer.innerHTML = '<div class="csStage"></div>'
    + '<div class="csCaption"><div class="csTitle"></div><div class="csSub"></div></div>'
    + '<div class="csSkip">点击跳过 ▸</div>';
  document.body.appendChild(layer);
  if (document.body.classList && typeof document.body.classList.add === 'function') {
    document.body.classList.add('cs-open');
  }
}

function removeLayer() {
  if (layer && typeof layer.remove === 'function') layer.remove();
  layer = null;
  if (document.body.classList && typeof document.body.classList.remove === 'function') {
    document.body.classList.remove('cs-open');
  }
}

function stageEl() { return layer ? layer.querySelector('.csStage') : null; }

/** 分镜视觉：按场景 id 生成舞台内容 */
function sceneHTML(sc) {
  switch (sc.id) {
    case 'alert':
      return '<div class="csAlertStripes"></div><div class="csAlertFrame"></div>'
        + '<div class="csAlertIcon">⚠</div>';
    case 'keys':
      return '<div class="csKeyRow">'
        + ['阿尔法', '布拉沃', '查理'].map((k, i) =>
          `<div class="csKey" style="--kd:${(0.25 + i * 0.3).toFixed(2)}s"><span class="csKeyDot"></span><span class="csKeyName">${k}</span></div>`
        ).join('')
        + '</div>';
    case 'launch':
      return [0, 1, 2].map(i =>
        `<div class="csMissile" style="--md:${(i * 0.22).toFixed(2)}s;left:${28 + i * 22}%"></div>`
      ).join('');
    default:
      return '';
  }
}

/** 字幕打字机；返回 interval 句柄，供调用方在跳过时立即补全 */
function typewriter(el, text) {
  if (RM || !text) { el.textContent = text; return null; }
  el.textContent = '';
  let i = 0;
  const timer = setInterval(() => {
    i++;
    el.textContent = text.slice(0, i);
    if (i >= text.length) { clearInterval(timer); }
  }, 34);
  return timer;
}

function waitOrSkip(ms, skip) {
  return new Promise(res => {
    if (skip.flag) { res(); return; }
    const t = setTimeout(() => { skip.resolve = null; res(); }, ms);
    skip.resolve = () => { clearTimeout(t); skip.resolve = null; res(); };
  });
}

/** 播放一段分镜序列；点击过场层跳过当前幕 */
export async function playCutscene(scenes) {
  if (!ENABLED || !Array.isArray(scenes) || !scenes.length) return;
  if (layer) removeLayer();
  buildLayer();
  const stage = stageEl();
  const titleEl = layer.querySelector('.csTitle');
  const subEl = layer.querySelector('.csSub');
  const speed = RM ? 0.35 : 1;
  const skip = { flag: false, resolve: null };
  const onSkip = () => {
    skip.flag = true;
    if (skip.resolve) skip.resolve();
  };
  if (layer.addEventListener) layer.addEventListener('pointerdown', onSkip);
  try {
    for (const sc of scenes) {
      skip.flag = false;
      if (stage) {
        stage.className = 'csStage cs-' + sc.id;
        stage.innerHTML = sceneHTML(sc);
      }
      if (subEl) subEl.classList.remove('in');
      if (titleEl) {
        const tw = typewriter(titleEl, sc.title);
        if (tw) {
          await waitOrSkip(Math.min(sc.title.length * 34 + 120, 900 * speed), skip);
          clearInterval(tw);
          titleEl.textContent = sc.title;
        }
      }
      if (subEl) {
        subEl.textContent = sc.sub || '';
        subEl.classList.add('in');
      }
      sfx('tick');
      // 旁白：与游戏内同一条在线语音链；没播完则续等，点击过场层可跳过
      const voiceP = ttsSpeakPrerecorded(cutsceneSpeakText(sc));
      await waitOrSkip(Math.max(420, (sc.ms || 1600) * speed), skip);
      if (!skip.flag) {
        await Promise.race([voiceP, waitOrSkip(12000, skip)]);
      }
      if (skip.flag && titleEl) titleEl.textContent = sc.title;
    }
  } finally {
    if (layer && layer.addEventListener) layer.removeEventListener('pointerdown', onSkip);
    // 转场淡出，把画面交还给棋盘特效（蘑菇云 / 冲击波）
    if (layer) layer.classList.add('csFadeout');
    await sleep(RM ? 60 : 420);
    removeLayer();
  }
}

/** 核弹结局专用过场：警报 → 密钥 → 发射，随后棋盘蘑菇云接管 */
export function playNukeCutscene() {
  return playCutscene(NUKE_SCENES);
}
