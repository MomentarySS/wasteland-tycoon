// 方案 B 预览：原 12×12 棋盘 + 中心信息中枢
(async function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  // ---- 1. 加载 tile 元数据 ----
  let meta = [];
  try { meta = await fetch('tiles-meta.json').then(r => r.json()); }
  catch (e) { console.error('载入 tiles-meta.json 失败', e); return; }

  // ---- 2. 渲染 12×12 棋盘 ----
  const N = 12;
  const perimeter = [];
  for (let x = 0; x < N; x++) perimeter.push([x, 0]);
  for (let y = 1; y < N; y++) perimeter.push([N - 1, y]);
  for (let x = N - 2; x >= 0; x--) perimeter.push([x, N - 1]);
  for (let y = N - 2; y >= 1; y--) perimeter.push([0, y]);

  const tilesRoot = $('#tiles');
  const frag = document.createDocumentFragment();
  const all = [];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const cell = document.createElement('div');
      const isEdge = (x === 0 || x === N - 1 || y === 0 || y === N - 1);
      cell.className = isEdge ? 'tile' : 'tile empty';
      frag.appendChild(cell);
      all.push(cell);
    }
  }
  tilesRoot.appendChild(frag);

  // 把 28 个 tile 数据放到外圈（前 28 个槽位）
  const tileMap = {}; // name -> {x, y, meta}
  perimeter.forEach(([x, y], i) => {
    if (i >= meta.length) return;
    const m = meta[i];
    const idx = y * N + x;
    const cell = all[idx];
    cell.classList.remove('empty');
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
    cell.dataset.name = m.name;
    cell.dataset.tag = m.tag;
    cell.dataset.img = m.img;
    if (m.name === '避难所出口') cell.classList.add('focused');
    tileMap[m.name] = { x, y, meta: m };
  });

  // ---- 3. 4 个玩家 token（叠在棋盘上） ----
  const TOKENS = [
    { name: '家甲', color: '#c9a227', x: 0,  y: 0,  label: '家' },
    { name: '玩',   color: '#3fb6c4', x: 4,  y: 0,  label: '玩' },
    { name: 'A2',   color: '#7fae6e', x: 0,  y: 6,  label: 'A2' },
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

  // ---- 4. fitBoard：填满 #board，cell 比例 1.85:1 ----
  const GAP = 3;
  const ASPECT = 1.85;
  function fitBoard() {
    const board = $('#board');
    if (!board) return;
    const cs = getComputedStyle(board);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const rect = board.getBoundingClientRect();
    const W = Math.max(200, rect.width  - padX);
    const H = Math.max(200, rect.height - padY);
    // 下限由上面两行的 Math.max(200, …) 保证：此前紧跟其后的
    // `if (W < 200 || H < 200) return;` 恒为假（W/H 已钳到 ≥200），属误导性的死
    // 守卫，删除。真正的保护就是这行钳位本身。

    let cw = Math.floor((W - GAP * (N - 1)) / N);
    let ch = Math.floor(cw / ASPECT);
    if (ch * N + GAP * (N - 1) > H) {
      ch = Math.floor((H - GAP * (N - 1)) / N);
      cw = Math.floor(ch * ASPECT);
    }
    cw = Math.max(28, cw); ch = Math.max(16, ch);

    const totalW = cw * N + GAP * (N - 1);
    const totalH = ch * N + GAP * (N - 1);
    const centerW = cw * 10 + GAP * 9;
    const centerH = ch * 10 + GAP * 9;
    const centerLeft = cw + GAP;
    const centerTop  = ch + GAP;

    const root = document.documentElement.style;
    root.setProperty('--cell-w', cw + 'px');
    root.setProperty('--cell-h', ch + 'px');
    root.setProperty('--gap', GAP + 'px');
    root.setProperty('--board-w', totalW + 'px');
    root.setProperty('--board-h', totalH + 'px');
    root.setProperty('--center-w', centerW + 'px');
    root.setProperty('--center-h', centerH + 'px');
    root.setProperty('--center-left', centerLeft + 'px');
    root.setProperty('--center-top',  centerTop  + 'px');

    tokenEls.forEach(t => {
      t.el.style.left = (t.x * (cw + GAP) + cw * 0.6) + 'px';
      t.el.style.top  = (t.y * (ch + GAP) + ch * 0.2) + 'px';
    });
  }
  fitBoard();
  window.addEventListener('resize', fitBoard);
  if (window.ResizeObserver) new ResizeObserver(fitBoard).observe($('#board'));

  // ---- 5. 中心信息中枢交互 ----
  // 5.1 聚焦地块切换（点击棋盘 tile → 更新中心上半卡）
  const focusImg = $('#focusImg');
  const focusName = $('#focusName');
  const focusDesc = $('#focusDesc');
  const focusStats = $('#focusStats');
  const focusTag = $('#focusTag');

  // 地块描述 + stat 配置（演示用）
  const TILE_DETAILS = {
    '避难所出口': {
      desc: '末世中最后的安全据点之一。经过此格可获得 +200 盖补给，并有机会进入避难所商店采购装备。',
      stats: [['过路', '+200'], ['停留', '商店'], ['所属', '公共']]
    },
    '森林断墙': {
      desc: '残存的混凝土路障，藏有零散物资。落入此格可能触发森林探索事件，获得木材或遭遇野兽。',
      stats: [['过路', '掷骰'], ['产出', '木材'], ['危险', '低']]
    },
    '莫诺加矿洞': {
      desc: '前矿场改建避难所。持有产权可每回合收取 80 盖租金，对所有过路幸存者征税。',
      stats: [['产权', '380 盖'], ['租金', '80/回合'], ['等级', 'Lv.1']]
    },
    '锈蚀管道': {
      desc: '地下工业遗迹，藏有稀有金属。每通过 1 次需掷骰判定，失败可能损失 50 盖或受轻伤。',
      stats: [['过路', '掷骰'], ['奖励', '金属'], ['风险', '中']]
    },
    '查理哨': {
      desc: '税收检查站。固定过路税 200 盖，所有玩家无差别征收。',
      stats: [['过路', '-200'], ['位置', '北哨'], ['所属', '公共']]
    },
    '国会掩体': {
      desc: '旧政府地下指挥中心。购入后可解锁"政策"系统，每回合对全图生效一项经济/军事指令。',
      stats: [['产权', '1200 盖'], ['效果', '政策'], ['等级', 'Lv.3']]
    },
    'default': {
      desc: '废土地图上的一个地点。具体效果取决于该地块的 tag（产权 / 事件 / 税收 / 探索 等）。',
      stats: [['tag', '通用'], ['等级', '—'], ['所属', '—']]
    }
  };

  function setFocus(name) {
    const d = TILE_DETAILS[name] || TILE_DETAILS['default'];
    const t = tileMap[name];
    if (t) {
      focusImg.style.backgroundImage = `url('${t.meta.img}')`;
      focusTag.textContent = t.meta.tag;
    } else {
      focusImg.style.backgroundImage = '';
      focusTag.textContent = '—';
    }
    focusName.textContent = name;
    focusDesc.textContent = d.desc;
    focusStats.innerHTML = d.stats.map(([k, v]) =>
      `<div class="fstat">${k} <b>${v}</b></div>`
    ).join('');
    // 高亮棋盘上对应 tile
    $$('.tile').forEach(c => c.classList.remove('focused'));
    Object.entries(tileMap).forEach(([n, info]) => {
      if (n === name) all[info.y * N + info.x].classList.add('focused');
    });
  }

  // 绑定点击事件
  $$('.tile').forEach(cell => {
    if (cell.dataset.name) {
      cell.addEventListener('click', () => setFocus(cell.dataset.name));
    }
  });

  // 5.2 玩家卡点击 → 同步切换到该玩家所在地块
  $$('.player-card').forEach((card, i) => {
    card.addEventListener('click', () => {
      $$('.player-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      const t = TOKENS[i];
      if (t && tileMap[card.querySelector('.ptile').textContent]) {
        setFocus(card.querySelector('.ptile').textContent);
      }
    });
  });

  // 5.3 玩家卡显示当前位置（同步到 token + tileMap）
  // 4 个玩家在初始时刻所在 tile：
  const PLAYER_POS = [
    { name: '家甲', tile: '避难所出口' },
    { name: '玩',   tile: '查理哨' },
    { name: 'A2',   tile: '阿尔法哨' },
    { name: 'A3',   tile: '国会掩体' },
  ];
  PLAYER_POS.forEach((p, i) => {
    const pos = tileMap[p.tile];
    if (pos) {
      tokenEls[i].x = pos.x;
      tokenEls[i].y = pos.y;
      // 触发 fitBoard 重定位
    }
  });
  // 跑一次重定位（用当前 cell 尺寸）
  fitBoard();

  // ---- 6. 行动日志 ----
  const log = $('#logBox');
  const LINES = [
    { cls: 't-turn', txt: '回合 12 开始 · 当前玩家：家甲' },
    { cls: 't-move', txt: '家甲：摩根镇废场 → 避难所出口 (+5 步)' },
    { cls: 't-cash', txt: '家甲：经过 起点 +200 盖' },
    { cls: 't-evt',  txt: '事件：响应者摊位来访（可购买）' },
    { cls: 't-move', txt: '玩：裂谷量子站 → 查理哨 (+2 步)' },
    { cls: 't-cash', txt: '玩：缴税 -200 盖' },
    { cls: 't-turn', txt: '回合 11 结束 · 进入 回合 12' },
  ];
  LINES.forEach(l => {
    const p = document.createElement('p');
    p.className = l.cls;
    p.textContent = '▸ ' + l.txt;
    log.appendChild(p);
  });
})();
