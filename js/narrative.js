// ============================================================
// narrative.js — 叙事传承：上局结局影响下局开局
// 根据上局 endKind + moral 生成叙事种子
// ============================================================

/** 叙事种子类型 */
export const NARRATIVE_SEEDS = {
  tyrant: {
    name: '暴君余波',
    intro: '你上局的暴政仍在废土回响。人们记住了你的名字——这一次，他们不会轻易信任你。',
    effects: { badEventBonus: 0.3, startRepPenalty: { eagle: -1, survivor: -1 } },
  },
  benevolent: {
    name: '仁心传承',
    intro: '你的善行在废土上流传。这一局，人们愿意向你伸出援手。',
    effects: { goodEventBonus: 0.3, startMoral: 2 },
  },
  nuke: {
    name: '核爆余烬',
    intro: '蘑菇云的阴影仍未散去。辐射尘在这一局格外频繁，废土在呻吟。',
    effects: { radiationLeak: 5, badEventBonus: 0.2 },
  },
  survivor: {
    name: '幸存者本能',
    intro: '你学会了如何在废土上活下去。这一局，你的直觉更加敏锐。',
    effects: { startCaps: 200, startGetOut: 1 },
  },
  coop_victory: {
    name: '战友情谊',
    intro: '上一局的战友仍在想念你。这一局，AI 会更愿意与你合作。',
    effects: { aiCoopBonus: 0.3, goodEventBonus: 0.15 },
  },
  survival: {
    name: '生存专家',
    intro: '无尽的废土衰减教会了你一切。这一局，你对危险更加警觉。',
    effects: { startCaps: 150, badEventBonus: -0.1 },
  },
  draw: {
    name: '命运中断',
    intro: '上一局的结局模糊不清。这一局，一切皆有可能。',
    effects: { randomStart: true },
  },
};

/** 根据上局结局生成叙事种子 */
export function getNarrativeSeed(endKind, moral = 0) {
  if (endKind === 'nuke') return NARRATIVE_SEEDS.nuke;
  if (endKind === 'campaign') {
    return moral >= 8 ? NARRATIVE_SEEDS.benevolent : moral >= 4 ? NARRATIVE_SEEDS.survivor : NARRATIVE_SEEDS.tyrant;
  }
  if (endKind === 'coop') return NARRATIVE_SEEDS.coop_victory;
  if (endKind === 'survival') return NARRATIVE_SEEDS.survival;
  if (endKind === 'draw') return NARRATIVE_SEEDS.draw;
  if (moral >= 10) return NARRATIVE_SEEDS.benevolent;
  if (moral <= 0) return NARRATIVE_SEEDS.tyrant;
  return NARRATIVE_SEEDS.survivor;
}

/** 应用叙事种子到下局游戏状态 */
export function applyNarrativeStart(G, seed) {
  if (!seed || !seed.effects) return;
  const e = seed.effects;
  if (e.badEventBonus) G.badEventBonus = (G.badEventBonus || 0) + e.badEventBonus;
  if (e.goodEventBonus) G.goodEventBonus = (G.goodEventBonus || 0) + e.goodEventBonus;
  if (e.startMoral) G.START_MORAL = (G.START_MORAL || 0) + e.startMoral;
  if (e.startCaps) G.STARTCAPS = (G.STARTCAPS || 1500) + e.startCaps;
  if (e.startGetOut) G.START_GETOUT = (G.START_GETOUT || 0) + e.startGetOut;
  if (e.radiationLeak) G.radiationLeak = (G.radiationLeak || 0) + e.radiationLeak;
  if (e.aiCoopBonus) G.aiCoopBonus = (G.aiCoopBonus || 0) + e.aiCoopBonus;
  if (e.startRepPenalty) G.startRepPenalty = { ...(G.startRepPenalty || {}), ...e.startRepPenalty };
  G.narrativeSeed = seed;
}

/** 格式化叙事 intro 文本（组装逻辑收敛到 voice-lines.js，与预录语音共用） */
import { narrativeSpeakText } from './voice-lines.js';
export function formatNarrativeIntro(seed) {
  return narrativeSpeakText(seed);
}
