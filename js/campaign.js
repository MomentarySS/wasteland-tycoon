// 单人闯关：章节目标、叙事变体、废土衰减、道德分支结局
import { eventArt } from './icons.js';

export const CAMPAIGNS = [
  {
    id: 'c1',
    name: '第一章 · 据点求生',
    brief: '末日第七日，你拖着半箱瓶盖逃出隔离区。先站稳脚跟，再谈别的。',
    decayPerTurn: 0,
    objectives: [
      { key: 'caps', text: '持有瓶盖 ≥ 1200', goal: 1200, get: (p) => p.caps },
      { key: 'districts', text: '占领 5 块地产', goal: 5, get: (p, ctx) => ctx.TILES.filter(t => t.type === 'prop' && t.owner === p.id).length },
      { key: 'moral', text: '道德值 ≥ 3', goal: 3, get: (p) => p.moral || 0 },
    ],
  },
  {
    id: 'c2',
    name: '第二章 · 垄断一方',
    brief: '物资开始流转，你得在某个区域说了算——但别在过程中丢了人心。',
    decayPerTurn: 0,
    objectives: [
      { key: 'mono', text: '凑齐任意一组地产垄断', goal: 1, get: (p, ctx) => {
          const groups = [...new Set(ctx.TILES.filter(t => t.type === 'prop').map(t => t.group))];
          return groups.filter(g => {
            const gs = ctx.TILES.filter(t => t.type === 'prop' && t.group === g);
            return gs.length > 0 && gs.every(t => t.owner === p.id && !t.mortgaged);
          }).length;
        } },
      { key: 'net', text: '净身家 ≥ 2600', goal: 2600, get: (p, ctx) => ctx.netWorth(p) },
      { key: 'moral', text: '道德值 ≥ 5', goal: 5, get: (p) => p.moral || 0 },
    ],
  },
  {
    id: 'c3',
    name: '第三章 · 黑市暗流',
    brief: '黑市账本在你手里流动。铁路与设施是废土的动脉——握住它们，或被人掐住咽喉。',
    decayPerTurn: 0,
    objectives: [
      { key: 'infra', text: '拥有 2 条铁路或 2 座设施', goal: 2, get: (p, ctx) => {
          const rails = ctx.TILES.filter(t => t.type === 'rail' && t.owner === p.id).length;
          const utils = ctx.TILES.filter(t => t.type === 'util' && t.owner === p.id).length;
          const r = rails >= 2 ? 2 : rails;
          const u = utils >= 2 ? 2 : utils;
          return Math.max(r, u);
        } },
      { key: 'net', text: '净身家 ≥ 3500', goal: 3500, get: (p, ctx) => ctx.netWorth(p) },
      { key: 'moral', text: '道德值 ≥ 6', goal: 6, get: (p) => p.moral || 0 },
    ],
  },
  {
    id: 'c4',
    name: '第四章 · 废土衰减',
    brief: '辐射尘暴不再间歇——每过一轮，土地就从账本上刮走一层。撑住，直到风暴过去。',
    decayPerTurn: 8,
    objectives: [
      { key: 'props', text: '持有 8 块以上地产', goal: 8, get: (p, ctx) => ctx.TILES.filter(t => t.type === 'prop' && t.owner === p.id).length },
      { key: 'net', text: '净身家 ≥ 4200', goal: 4200, get: (p, ctx) => ctx.netWorth(p) },
      { key: 'moral', text: '道德值 ≥ 7', goal: 7, get: (p) => p.moral || 0 },
    ],
  },
  {
    id: 'c5',
    name: '第五章 · 废土传说',
    brief: '当名字被刻进幸存者手册，你就不再是逃兵，而是被传颂的传说。',
    decayPerTurn: 12,
    objectives: [
      { key: 'net', text: '净身家 ≥ 5000', goal: 5000, get: (p, ctx) => ctx.netWorth(p) },
      { key: 'props', text: '持有 12 块以上地产', goal: 12, get: (p, ctx) => ctx.TILES.filter(t => t.type === 'prop' && t.owner === p.id).length },
      { key: 'moral', text: '道德值 ≥ 8', goal: 8, get: (p) => p.moral || 0 },
    ],
  },
  {
    id: 'c6',
    name: '第六章 · 废土归属',
    brief: '传说终有结局。你是让废土变成家园，还是让家园变成传说？',
    decayPerTurn: 15,
    objectives: [
      { key: 'net', text: '净身家 ≥ 6500', goal: 6500, get: (p, ctx) => ctx.netWorth(p) },
      { key: 'props', text: '持有 16 块以上地产', goal: 16, get: (p, ctx) => ctx.TILES.filter(t => t.type === 'prop' && t.owner === p.id).length },
      { key: 'moral', text: '道德值 ≥ 10', goal: 10, get: (p) => p.moral || 0 },
    ],
  },
];

/**
 * 章节开场叙事变体：按进入章节时的人类道德值选取（minMoral 降序，取首个匹配）
 * moral 来自上一章结束时的积累（第一章开局传 0）
 */
export const CHAPTER_INTROS = [
  {
    variants: [
      { minMoral: 4, title: '据点求生 · 第七日', story: '隔离区的警报还在远处嗡鸣。有人把最后半瓶水塞给你——你攥着瓶盖踏出铁门，身后是秩序，前方是废土。营地的人看着你：像领路人，而不只是独狼。', artKey: 'shield' },
      { minMoral: 0, title: '据点求生 · 第七日', story: '隔离区的警报还在远处嗡鸣。你攥着最后一把瓶盖，踏出铁门——身后是秩序，前方是废土。营地的人看着你：是独狼，还是领路人？', artKey: 'shield' },
      { minMoral: -Infinity, title: '据点求生 · 第七日', story: '隔离区的警报还在远处嗡鸣。你踹开铁门，把挡路的人推进阴影——瓶盖在口袋里撞出冷响。前方是废土，而你只信自己。', artKey: 'trap' },
    ],
  },
  {
    variants: [
      { minMoral: 6, title: '垄断一方 · 公义价码', story: '黑市开始按你的价码流通，但你也给穷人留了条活路。军阀派人带话：要么交保护费，要么交命。你意识到，「公平交易」也需要有人站出来说话。', artKey: 'shield' },
      { minMoral: 3, title: '垄断一方 · 权力真空', story: '黑市开始按你的价码流通。军阀派人带话：要么交保护费，要么交命。你意识到，在这片土地上，「公平交易」也需要有人站出来说话。', artKey: 'bandit' },
      { minMoral: -Infinity, title: '垄断一方 · 新军阀', story: '黑市开始按你的价码流通——只对你有利的那种。军阀的人来了，你让他们空手回去。营地的人不再叫你名字，他们叫你「老板」。', artKey: 'bandit' },
    ],
  },
  {
    variants: [
      { minMoral: 7, title: '黑市暗流 · 账本上的名字', story: '铁路调度员把密钥塞给你：「只给还愿意分粮给月台的人。」你明白，废土的动脉不在轨道，而在谁肯让谁活下去。', artKey: 'gear' },
      { minMoral: 4, title: '黑市暗流 · 枢纽争夺', story: '铁路与净水站成了新的战场。每一张过路条都在标价，而你必须在扩张与声誉之间做取舍。', artKey: 'gear' },
      { minMoral: -Infinity, title: '黑市暗流 · 断供威胁', story: '你掐住了两条铁路的阀门。对手开始断供，营地里的抱怨声像砂纸一样磨耳朵——你知道，这局没有无辜的赢家。', artKey: 'gas' },
    ],
  },
  {
    variants: [
      { minMoral: 8, title: '废土衰减 · 共担风暴', story: '辐射尘暴来了，不再间歇。你把储粮打开一半分给营火旁的人——风暴会刮走瓶盖，但刮不走一起扛过黑夜的名字。', artKey: 'rad' },
      { minMoral: 5, title: '废土衰减 · 风暴季节', story: '辐射尘暴来了，不再间歇。每过一轮，土地就从账本上刮走一层。你得在缩水之前，把根扎得更深。', artKey: 'rad' },
      { minMoral: -Infinity, title: '废土衰减 · 各自为战', story: '辐射尘暴来了。你加固了地堡，把门闩插上——外面是谁在敲，你已经不太想分辨。每轮流失的瓶盖，是废土在收租。', artKey: 'storm' },
    ],
  },
  {
    variants: [
      { minMoral: 9, title: '废土传说 · 仁心账本', story: '幸存者手册缺了最后一页——留给「传说」的名字。你回望来路：每一次抉择都在账本上留下墨迹，而人们愿意跟随你，不是因为恐惧。', artKey: 'caps' },
      { minMoral: 6, title: '废土传说 · 最后的账本', story: '幸存者手册缺了最后一页——留给「传说」的名字。你回望来路：每一次抉择都在账本上留下墨迹。今天，这笔账该结了。', artKey: 'caps' },
      { minMoral: -Infinity, title: '废土传说 · 新秩序', story: '幸存者手册缺了最后一页。你回望来路：瓶盖、地盘、恐惧——它们都写进了你的名字。今天，这笔账该结了，而营地的人学会了低头。', artKey: 'horde' },
    ],
  },
  {
    variants: [
      { minMoral: 12, title: '废土归属 · 家园落成', story: '你站在自己修建的围墙上，看着炊烟从营地升起。这片曾经荒芜的土地，如今有了名字、有了孩子、有了明天。', artKey: 'shield' },
      { minMoral: 8, title: '废土归属 · 终局之问', story: '废土在你手中慢慢变样——但你开始问自己：这一切是为了谁？当最后一个目标达成，传说才真正开始。', artKey: 'caps' },
      { minMoral: -Infinity, title: '废土归属 · 铁血归宿', story: '你征服了这片土地上能征服的一切。人们在你面前低头——但没人知道你的名字背后，藏着多少未冷的血。', artKey: 'horde' },
    ],
  },
];

/** 道德分支结局（通关最终章后按 moral 判定） */
export const CAMPAIGN_ENDINGS = [
  { minMoral: 14, subtitle: '传说·家园建造者', log: '📖 你不只是征服了废土——你让废土变成了家园。你的名字被刻在新建的围墙上，孩子们在你的庇护下长大。' },
  { minMoral: 10, subtitle: '传说·仁心领袖', log: '📖 你的名字与道德一起被刻进手册首页——人们说，废土因你而少了几分残酷。' },
  { minMoral: 8, subtitle: '通关·废土传说', log: '📖 你完成了全部章节，名字被刻进幸存者手册——你成了废土传说。' },
  { minMoral: 4, subtitle: '通关·冷面幸存者', log: '📖 你活下来了，也赢了。手册里你的名字旁边，只写了两个字：「实用」。' },
  { minMoral: -Infinity, subtitle: '通关·暴君', log: '📖 你聚敛了财富与地盘，营地的人在背后叫你「新军阀」——传说有很多种写法。' },
];

function pickIntroVariant(block, moral) {
  const variants = (block && block.variants) ? block.variants.slice() : [];
  if (!variants.length) return null;
  variants.sort((a, b) => b.minMoral - a.minMoral);
  const m = moral != null ? moral : 0;
  for (const v of variants) {
    if (m >= v.minMoral) return v;
  }
  // 兜底：数据上末位变体的 minMoral 恒为 -Infinity，正常不会落到这里。
  // 保留是因为 CHAPTER_INTROS / ENDINGS 为手写内容，新增章节漏写兜底变体时
  // 这行仍能保证返回一个变体，而不是 undefined。
  return variants[variants.length - 1];
}

export function getChapterIntro(idx, moral = 0) {
  const picked = pickIntroVariant(CHAPTER_INTROS[idx], moral);
  if (!picked) return null;
  return { title: picked.title, story: picked.story, art: eventArt(picked.artKey) };
}

export function getCampaignEnding(moral) {
  for (const e of CAMPAIGN_ENDINGS) {
    if (moral >= e.minMoral) return e;
  }
  return CAMPAIGN_ENDINGS[CAMPAIGN_ENDINGS.length - 1];
}

export function evaluateCampaign(p, ctx, idx = 0) {
  const ch = CAMPAIGNS[idx] || CAMPAIGNS[0];
  const objs = ch.objectives.map(o => {
    const v = o.get(p, ctx) || 0;
    return { text: o.text, goal: o.goal, value: v, done: v >= o.goal };
  });
  return {
    id: ch.id,
    name: ch.name,
    brief: ch.brief,
    decayPerTurn: ch.decayPerTurn || 0,
    objs,
    done: objs.every(o => o.done),
  };
}

/**
 * 合作闯关：双人共享章节目标评估（human + ally 联合进度）
 * 规则：瓶盖/地产取双方总和，道德取人类值
 */
export function evaluateCampaignCoop(human, ally, ctx, idx = 0) {
  const ch = CAMPAIGNS[idx] || CAMPAIGNS[0];
  const teammates = [human, ally].filter(Boolean);
  const objs = ch.objectives.map(o => {
    let v;
    if (o.key === 'moral') {
      // 道德取人类值（决策主体）
      v = o.get(human, ctx) || 0;
    } else {
      // 瓶盖 / 身家 / 地产 / 垄断 / 设施一律取双方总和
      v = teammates.reduce((sum, p) => sum + (o.get(p, ctx) || 0), 0);
    }
    return { text: o.text, goal: o.goal, value: v, done: v >= o.goal };
  });
  return {
    id: ch.id,
    name: ch.name,
    brief: ch.brief,
    decayPerTurn: ch.decayPerTurn || 0,
    objs,
    done: objs.every(o => o.done),
  };
}

export function campaignCount() { return CAMPAIGNS.length; }

/** 当前章节道德目标（供 AI / UI 提示） */
export function campaignMoralGoal(idx) {
  const ch = CAMPAIGNS[idx];
  if (!ch) return 0;
  const mo = ch.objectives.find(o => o.key === 'moral');
  return mo ? mo.goal : 0;
}

/** 当前章节废土衰减（每回合全员扣盖，0 表示无衰减） */
export function campaignDecayPerTurn(idx) {
  const ch = CAMPAIGNS[idx];
  return ch && ch.decayPerTurn ? ch.decayPerTurn : 0;
}
