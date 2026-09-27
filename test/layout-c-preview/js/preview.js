// 方案 C 预览：纯前端展示，无游戏逻辑
(async function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  // ---- 1. 加载 tile 元数据 ----
  let meta = [];
  try {
    meta = await fetch('tiles-meta.json').then(r => r.json());
  } catch (e) {
    console.error('载入 tiles-meta.json 失败', e);
    return;
  }

  // ---- 2. 4 段式渲染：顶行 12 / 右列 10 / 底行 12 / 左列 10 = 44 格（去重后 32）----
  // 顺序：顶行 12（x=0..11）→ 右列 10（y=1..10）→ 底行 12（x=11..0）→ 左列 10（y=10..1）
  // 围成外圈，首尾 4 个角各有 1 个，去重后 = 12+10+10+10 = 42（4 角各 2 次）
  // 实际唯一 32 个。我们给 32 个槽位，meta 只有 28 个，后面 4 个空着
  const SLOTS = [];
  for (let x = 0; x < 12; x++) SLOTS.push({ x, y: 0,  side: 'top' });
  for (let y = 1; y < 11; y++) SLOTS.push({ x: 11, y, side: 'right' });
  for (let x = 11; x >= 0; x--) SLOTS.push({ x, y: 11, side: 'bottom' });
  for (let y = 10; y >= 1; y--) SLOTS.push({ x: 0,  y, side: 'left' });
  // SLOTS 长度 12+10+12+10 = 44，其中 4 个角（0,0)(11,0)(11,11)(0,11) 各出现 2 次
  // 真正唯一外圈格 = 12*4 - 4 = 44 - 4 = 40. 我们这里 44 个槽位（含重复角）
  // 简化：去重
  const seen = new Set();
  const unique = SLOTS.filter(s => {
    const k = s.x + ',' + s.y;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  // unique 长度 = 40 (实际外圈 12+10+10+10 = 40)
  // 但原游戏 12x12 外圈 = 12*4 - 4 = 40 ✓

  // 把 28 块 tile 放到前 28 个槽位
  const tileEls = []; // 用于 fitBoard 重定位
  unique.forEach((slot, i) => {
    const cell = document.createElement('div');
    cell.className = 'tile';
    if (i < meta.length) {
      const m = meta[i];
      cell.style.backgroundImage = `url('${m.img}')`;
      const name = document.createElement('div');
      name.className = 'tname';
      name.textContent = m.name;
      cell.appendChild(name);
      const tag = document.createElement('div');
      tag.className = 'ttag';
      tag.textContent = m.tag;
      cell.appendChild(tag);
      cell.title = `${m.name} · ${m.tag}`;
      if (m.name === '避难所出口') cell.classList.add('focused');
    } else {
      // 没分配的格子 - 暗色占位
      cell.style.background = '#0e1213';
      cell.style.opacity = '0.4';
    }
    // 按 side 放到对应容器
    if (slot.side === 'top') $('#boardTop').appendChild(cell);
    else if (slot.side === 'bottom') $('#boardBottom').appendChild(cell);
    else if (slot.side === 'left') $('#boardLeft').appendChild(cell);
    else if (slot.side === 'right') $('#boardRight').appendChild(cell);
    // 记录槽位的 x/y 用于 token 重定位
    tileEls.push({ el: cell, x: slot.x, y: slot.y, side: slot.side });
  });

  // ---- 3. 玩家 token 演示 ----
  const TOKENS = [
    { name: '家甲', color: '#c9a227', x: 11, y: 0,  label: '家' },
    { name: '玩',   color: '#3fb6c4', x: 6,  y: 0,  label: '玩' },
    { name: 'A2',   color: '#7fae6e', x: 0,  y: 7,  label: 'A2' },
    { name: 'A3',   color: '#b06ad8', x: 11, y: 11, label: 'A3' },
  ];
  const inner = $('#boardInner');
  const tokenEls = [];
  TOKENS.forEach(t => {
    const el = document.createElement('div');
    el.className = 'token';
    el.textContent = t.label;
    el.style.color = t.color;
    el.style.background = t.color;
    el.title = t.name;
    inner.appendChild(el);
    tokenEls.push({ el, ...t });
  });

  // ---- 4. fitBoard：填满 #board 容器，4 段式独立算 cell-w / cell-h ----
  const GAP = 3;
  function fitBoard() {
    const board = $('#board');
    if (!board) return;
    const cs = getComputedStyle(board);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const rect = board.getBoundingClientRect();
    const W = Math.max(200, rect.width  - padX);
    const H = Math.max(200, rect.height - padY);
    if (W < 200 || H < 200) return;

    // 顶/底行宽 = 12cw + 11gap = 总宽 W
    const cw = Math.floor((W - GAP * 11) / 12);
    // 左/右列高 = 10ch + 9gap（中间段高度）
    // 中段总高 = ch + 9gap + 中心高 + 9gap + ch = 2ch + 18gap + centerH
    // 而中段高 = H - 2ch - 2gap（顶/底行各占 ch + 1gap 高度）
    // 简化为：左/右列高 + 中心高 = H - 2*ch - 2*gap
    // 中心高 = 10ch + 9gap
    // 所以：10ch + 9gap + 9gap + 2*ch = H - 2*gap
    //     12ch = H - 2*gap - 18gap = H - 20*gap
    //     ch = (H - 20*gap) / 12
    const ch = Math.max(16, Math.floor((H - GAP * 20) / 12));

    // 兜底最小值
    const cw2 = Math.max(28, cw);

    const totalW = cw2 * 12 + GAP * 11;
    const totalH = ch  * 12 + GAP * 11;  // 顶 ch + 中(ch+centerH+ch)+ 底 ch + 3 段 gap
    // 中心宽 = 10cw + 9gap, 中心高 = 10ch + 9gap

    const root = document.documentElement.style;
    root.setProperty('--cell-w', cw2 + 'px');
    root.setProperty('--cell-h', ch + 'px');
    root.setProperty('--gap', GAP + 'px');
    root.setProperty('--board-w', totalW + 'px');
    root.setProperty('--board-h', totalH + 'px');
    root.setProperty('--center-w', (cw2 * 10 + GAP * 9) + 'px');
    root.setProperty('--center-h', (ch  * 10 + GAP * 9) + 'px');

    // token 定位：用 4 段坐标映射
    // top: y=0, x=0..11 → top: ch*0.2, left: x*(cw+gap) + cw*0.6
    // right: x=11, y=1..10 → top: y*(ch+gap) + ch*0.2, left: 11*(cw+gap) + cw*0.6
    // bottom: y=11, x=11..0 → top: 11*(ch+gap) + ch*0.2, left: x*(cw+gap) + cw*0.6
    // left: x=0, y=10..1 → top: y*(ch+gap) + ch*0.2, left: 0*(cw+gap) + cw*0.6
    tokenEls.forEach(t => {
      t.el.style.left = (t.x * (cw2 + GAP) + cw2 * 0.6) + 'px';
      t.el.style.top  = (t.y * (ch  + GAP) + ch  * 0.2) + 'px';
    });
  }

  fitBoard();
  window.addEventListener('resize', fitBoard);
  if (window.ResizeObserver) {
    new ResizeObserver(fitBoard).observe($('#board'));
  }

  // ---- 5. 底部情报流 ----
  const flow = $('#intelFlow');
  const INTEL = [
    { tag: '资金', title: '缴税 200 盖', meta: '回合 11 · 触发格：查理哨' },
    { tag: '产权', title: '购入 森林断墙', meta: '+地产 · 价值 380 盖' },
    { tag: '事件', title: '遭遇 掠夺者袭击', meta: '损失 50 盖 · 掷骰判定' },
    { tag: '建造', title: '避难所升级 Lv.2', meta: '人口 +2 · 维护 +20/回合' },
    { tag: '探索', title: '发现 锈蚀管道', meta: '解锁隐藏通道' },
    { tag: '悬赏', title: '猎杀 灰堆掠夺者', meta: '奖励 800 盖 · 时限 5 回合' },
    { tag: '系统', title: '天气转 沙尘暴', meta: '可视范围 -2 格' },
    { tag: '资金', title: '通过 起点 +200', meta: '家甲 +200 盖' },
    { tag: '事件', title: '响应者摊位 来访', meta: '可购买 1 件装备' },
    { tag: '产权', title: '租金 +120', meta: '格拉夫顿补给 · 玩付' },
    { tag: '建造', title: '改装工坊 完工', meta: '载具 +1 槽位' },
    { tag: '探索', title: '发现 辐射残留', meta: '连续 3 回合 体力 -1' },
  ];
  INTEL.forEach(it => {
    const c = document.createElement('div');
    c.className = 'intel-card';
    c.innerHTML = `
      <div class="ic-tag">// ${it.tag}</div>
      <div class="ic-title">${it.title}</div>
      <div class="ic-meta">${it.meta}</div>
    `;
    flow.appendChild(c);
  });

  // tab 切换
  $$('#intelTabs .tab').forEach(t => {
    t.addEventListener('click', () => {
      $$('#intelTabs .tab').forEach(x => x.classList.remove('on'));
      t.classList.add('on');
      const cat = t.dataset.cat;
      $$('.intel-card', flow).forEach((c, i) => {
        const match = cat === 'all' || INTEL[i].tag === ({cash:'资金',prop:'产权',build:'建造',event:'事件',bounty:'悬赏',explore:'探索',system:'系统'})[cat];
        c.style.display = match ? '' : 'none';
      });
    });
  });

  // ---- 6. 行动日志（更多条目，撑高日志区） ----
  const log = $('#logBox');
  const LINES = [
    { cls: 't-turn', txt: '回合 12 开始 · 当前玩家：家甲' },
    { cls: 't-move', txt: '家甲：摩根镇废场 → 避难所出口 (+5 步)' },
    { cls: 't-cash', txt: '家甲：经过 起点 +200 盖' },
    { cls: 't-evt',  txt: '事件：响应者摊位来访（可购买）' },
    { cls: 't-move', txt: '玩：裂谷量子站 → 查理哨 (+2 步)' },
    { cls: 't-cash', txt: '玩：缴税 -200 盖' },
    { cls: 't-turn', txt: '回合 11 结束 · 进入 回合 12' },
    { cls: 't-evt',  txt: '系统：天气转 沙尘暴（-2 视野）' },
    { cls: 't-move', txt: '家甲：从避难所出口出发 (+0 步)' },
  ];
  LINES.forEach(l => {
    const p = document.createElement('p');
    p.className = l.cls;
    p.textContent = '▸ ' + l.txt;
    log.appendChild(p);
  });
})();
