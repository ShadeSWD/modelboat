/* Конструктор модели: связывает ползунки, расчётное ядро (hull.js),
 * базу компонентов (parts.js) и чертежи. Внутри всё в СИ, на экране мм и г. */
'use strict';

/* ---------- запасная база компонентов ----------
 * Основная лежит в parts.js (PARTS_DB); если она не загрузилась,
 * конструктор работает на сокращённой копии с теми же id. */
const FALLBACK_DB = {
  parts: {
    esp32c3: { name: 'ESP32-C3 SuperMini', cat: 'плата', L: 23, W: 18, H: 5, mass: 3 },
    nano: { name: 'Arduino Nano', cat: 'плата', L: 45, W: 18, H: 8, mass: 7 },
    hm10: { name: 'Bluetooth HM-10', cat: 'плата', L: 38, W: 16, H: 6, mass: 4 },
    mx1508: { name: 'Драйвер MX1508', cat: 'плата', L: 25, W: 20, H: 4, mass: 2 },
    motor_n20: { name: 'Мотор-редуктор N20', cat: 'привод', L: 26, W: 12, H: 10, mass: 10 },
    motor_130: { name: 'Мотор 130', cat: 'привод', L: 38, W: 21, H: 25, mass: 18, shape: 'cyl' },
    servo_sg90: { name: 'Серво SG90', cat: 'привод', L: 23, W: 12, H: 29, mass: 9 },
    batt_18650: { name: 'Аккумулятор 18650', cat: 'питание', L: 65, W: 19, H: 19, mass: 46, shape: 'cyl' },
    holder_1x18650: { name: 'Холдер 1×18650', cat: 'питание', L: 78, W: 21, H: 15, mass: 9 },
    holder_2x18650: { name: 'Холдер 2×18650', cat: 'питание', L: 78, W: 41, H: 15, mass: 15 },
    tp4056: { name: 'Зарядка TP4056', cat: 'питание', L: 26, W: 17, H: 4, mass: 2 },
    buck_mini360: { name: 'Понижайка mini-360', cat: 'питание', L: 17, W: 11, H: 4, mass: 1.5 },
    switch_kcd: { name: 'Выключатель', cat: 'механика', L: 15, W: 10, H: 20, mass: 3 },
    shaft_m2: { name: 'Вал с дейдвудом', cat: 'механика', L: 150, W: 5, H: 5, mass: 14, shape: 'cyl' },
    prop_30: { name: 'Винт Ø30', cat: 'механика', L: 8, W: 30, H: 30, mass: 2, shape: 'cyl' },
    prop_35: { name: 'Винт Ø35', cat: 'механика', L: 9, W: 35, H: 35, mass: 3, shape: 'cyl' },
    coupling: { name: 'Муфта вала', cat: 'механика', L: 20, W: 9, H: 9, mass: 5, shape: 'cyl' },
    rudder_gear: { name: 'Баллер и качалка', cat: 'механика', L: 30, W: 10, H: 60, mass: 6 },
    wires: { name: 'Провода и мелочь', cat: 'крепёж и расходники', L: 60, W: 30, H: 10, mass: 12 },
    screws_m3: { name: 'Крепёж М2/М3', cat: 'крепёж и расходники', L: 40, W: 20, H: 10, mass: 10 },
  },
  kits: {
    micro: { title: 'Микро (двухвальный)', parts: [
      { id: 'esp32c3', qty: 1 }, { id: 'mx1508', qty: 1 }, { id: 'motor_n20', qty: 2 },
      { id: 'shaft_m2', qty: 2 }, { id: 'prop_30', qty: 2 }, { id: 'coupling', qty: 2 },
      { id: 'batt_18650', qty: 1 }, { id: 'holder_1x18650', qty: 1 }, { id: 'tp4056', qty: 1 },
      { id: 'switch_kcd', qty: 1 }, { id: 'wires', qty: 1 }, { id: 'screws_m3', qty: 1 }] },
    classic: { title: 'Классика (одновальный с рулём)', parts: [
      { id: 'nano', qty: 1 }, { id: 'hm10', qty: 1 }, { id: 'mx1508', qty: 1 },
      { id: 'motor_130', qty: 1 }, { id: 'coupling', qty: 1 }, { id: 'shaft_m2', qty: 1 },
      { id: 'prop_35', qty: 1 }, { id: 'servo_sg90', qty: 1 }, { id: 'rudder_gear', qty: 1 },
      { id: 'batt_18650', qty: 2 }, { id: 'holder_2x18650', qty: 1 }, { id: 'buck_mini360', qty: 1 },
      { id: 'switch_kcd', qty: 1 }, { id: 'wires', qty: 1 }, { id: 'screws_m3', qty: 1 }] },
  },
};
function partsDb() { return (typeof PARTS_DB !== 'undefined') ? PARTS_DB : FALLBACK_DB; }

/* винтомоторные данные наборов: диаметр/шаг винта (м), обороты под
 * нагрузкой (об/с, ≈70 % холостых), ток хода (А), ёмкость батареи (А·ч) */
const DRIVE = {
  micro: { D: 0.030, pitch: 0.034, rpm: 40, count: 2, amp: 0.9, cap: 2.6, motor: 'два N20' },
  classic: { D: 0.035, pitch: 0.042, rpm: 95, count: 1, amp: 1.6, cap: 2.6, motor: 'мотор 130' },
};

/* размещение по умолчанию: {id, x в долях L, стопка?} */
const LAYOUT = {
  micro: [
    { id: 'motor_n20', q: 2, fx: 0.20, twin: true }, { id: 'mx1508', q: 1, fx: 0.30 },
    { id: 'holder_1x18650', q: 1, fx: 0.38, with: 'batt_18650' },
    { id: 'esp32c3', q: 1, fx: 0.58 }, { id: 'tp4056', q: 1, fx: 0.65 },
    { id: 'switch_kcd', q: 1, fx: 0.74 }, { id: 'wires', q: 1, fx: 0.36 },
    { id: 'screws_m3', q: 1, fx: 0.52 },
  ],
  classic: [
    { id: 'rudder_gear', q: 1, fx: 0.045 }, { id: 'servo_sg90', q: 1, fx: 0.115 },
    { id: 'motor_130', q: 1, fx: 0.24 }, { id: 'coupling', q: 1, fx: 0.175 },
    { id: 'mx1508', q: 1, fx: 0.31 }, { id: 'buck_mini360', q: 1, fx: 0.35 },
    { id: 'holder_2x18650', q: 1, fx: 0.52, with: 'batt_18650' },
    { id: 'nano', q: 1, fx: 0.63 }, { id: 'hm10', q: 1, fx: 0.70 },
    { id: 'switch_kcd', q: 1, fx: 0.76 }, { id: 'wires', q: 1, fx: 0.38 },
    { id: 'screws_m3', q: 1, fx: 0.55 },
  ],
};

const state = {
  proto: 'tug', L: 450, LB: 5.2, DB: 0.85,
  full: 1, transom: 1, bow: 1,
  wall: 1.6, mat: 'pla', ballast: 120, ballastFx: 0.52,
  pos: {},          // переопределённые пользователем x (доли L) по id
};
function kitOf() { return HULLJS.PROTOS[state.proto].shafts === 2 ? 'micro' : 'classic'; }

/* обёртка над модулем ядра (в браузере функции глобальные) */
const HULLJS = {
  PROTOS, makeHull, hydrostatics, equilibrium, gzCurve, shellArea, shellProps,
  hullVolume, speedPredict, yAt,
};

/* ---------- полный пересчёт ---------- */
function compute() {
  const L = state.L / 1000, B = L / state.LB, D = B * state.DB;
  const hull = makeHull(state.proto, { L, B, D },
    { full: state.full, transom: state.transom, bow: state.bow });
  const wall = state.wall / 1000;
  const rhoP = state.mat === 'petg' ? 1270 : 1240;
  const sp = shellProps(hull);

  // масса корпуса
  const kPrint = 1.07; // периметры, неидеальность заполнения
  const mShell = sp.A * wall * rhoP * kPrint;
  const mFrames = 0.06 * mShell;                 // флоры и кницы (фундаменты — отдельными деталями)
  const mDeck = sp.Adeck * wall * rhoP;
  const mLacq = (2 * sp.A + sp.Adeck) * 0.10;    // лак ≈100 г/м² на слой·стороны
  const hullMass = mShell + mFrames + mDeck;

  // компоненты набора по местам
  const db = partsDb(), kit = kitOf();
  const comps = [];
  for (const item of LAYOUT[kit]) {
    const p = db.parts[item.id];
    if (!p) continue;
    let mass = p.mass, name = p.name, Lmm = p.L, Wmm = p.W, Hmm = p.H;
    if (item.with) { // холдер вместе с аккумулятором(и)
      const sub = db.parts[item.with];
      const q = (db.kits[kit].parts.find(k => k.id === item.with) || { qty: 1 }).qty;
      mass += sub.mass * q; name += ' + ' + q + '×' + sub.name;
      Hmm = p.H + sub.H;
    }
    const fx = (state.pos[item.id] !== undefined) ? state.pos[item.id] : item.fx;
    const x = fx * L;
    for (let c = 0; c < (item.q || 1); c++) {
      const y = item.twin ? (c === 0 ? 1 : -1) * 0.22 * B : 0;
      // опора на днище: линия киля станции + стенка + зазор
      // (для V-образной Athena компоненты стоят на платформе над килем)
      const stI = hull.stations[Math.round(fx * (hull.stations.length - 1))];
      const seat = PROTOS[state.proto].table === 'athena' ? 0.010 : 0.002;
      const zin = stI.pts[0].z + wall + seat;
      const z = zin + Hmm / 2000;
      comps.push({
        id: item.id, name, x, y, z, fx, mass: mass / 1000,
        Lmm, Wmm, Hmm, shape: p.shape || 'box', twin: !!item.twin, drag: true,
      });
    }
  }
  const mComps = comps.reduce((s, c) => s + c.mass, 0);
  const mBall = state.ballast / 1000;
  const xBall = state.ballastFx * L;
  const stB = hull.stations[Math.round(state.ballastFx * (hull.stations.length - 1))];
  const zBall = stB.pts[0].z + wall + 0.004;

  // нагрузка без креплений — первый проход равновесия (нужна осадка,
  // чтобы поставить винт и перо; крепления добавятся вторым проходом)
  const rows0 = [
    { name: 'Оболочка корпуса', m: mShell, x: sp.x, z: sp.z },
    { name: 'Набор (флоры, кницы)', m: mFrames, x: sp.x, z: sp.z * 0.6 },
    { name: 'Палуба и люк', m: mDeck, x: sp.xdeck, z: D },
    { name: 'Лак', m: mLacq, x: sp.x, z: sp.z },
    ...comps.map(c => ({ name: c.name, m: c.mass, x: c.x, z: c.z })),
    { name: 'Балласт', m: mBall, x: xBall, z: zBall },
  ];
  const M0 = rows0.reduce((s, r) => s + r.m, 0);
  const eq0 = equilibrium(hull, M0,
    rows0.reduce((s, r) => s + r.m * r.x, 0) / M0,
    rows0.reduce((s, r) => s + r.m * r.z, 0) / M0);

  // линия вала и перо руля (по осадке первого прохода)
  const twin = PROTOS[state.proto].shafts === 2;
  const dr = DRIVE[kit];
  const motor = comps.find(c => c.id === 'motor_130' || c.id === 'motor_n20');
  const xProp = 0.03 * L;
  const zProp = eq0.floats ? Math.max(wall + 0.004, eq0.T - dr.D / 2 - 0.004) : 0.01;
  const shaftLine = [];
  const nSh = twin ? 2 : 1;
  for (let i = 0; i < nSh; i++) {
    shaftLine.push({
      x1: xProp, z1: zProp,
      x2: motor ? motor.x : 0.2 * L, z2: motor ? motor.z : 0.02,
      y: twin ? (i === 0 ? 1 : -1) * 0.22 * B : 0,
    });
  }
  const rudder = PROTOS[state.proto].rudder
    ? { x: 0.012 * L, chord: Math.round(0.06 * L * 1000), span: Math.round((eq0.floats ? eq0.T : D / 2) * 0.9 * 1000), thick: 3 }
    : null;

  // крепления и оснастка (fittings.js): печатные детали под этот корпус
  let fits = [];
  if (typeof buildFittings === 'function') {
    fits = buildFittings({
      kit, parts: db.parts, hullStations: hull.stations, L, B, D, wall,
      ballast: state.ballast, ballastFx: state.ballastFx, comps,
      shaftAngleDeg: Math.atan2(shaftLine[0].z2 - shaftLine[0].z1,
        shaftLine[0].x2 - shaftLine[0].x1) * 180 / Math.PI,
      rudder: rudder ? { x: rudder.x * 1000, chord: rudder.chord, span: rudder.span, thick: rudder.thick } : null,
      shaftMM: shaftLine.map(s => ({
        x1: s.x1 * 1000, z1: s.z1 * 1000, x2: s.x2 * 1000, z2: s.z2 * 1000, y: s.y * 1000,
      })),
    });
  }
  const fitsAboard = fits.filter(f => f.place); // стапель остаётся на берегу
  const mFits = fitsAboard.reduce((s, f) => s + f.mass, 0) / 1000;

  // окончательная нагрузка — с креплениями
  const rows = rows0.concat(fitsAboard.map(f => ({
    name: f.name, m: f.mass / 1000, x: f.place.x / 1000, z: (f.place.z + f.dims[2] / 2) / 1000,
    fit: true,
  })));
  const M = rows.reduce((s, r) => s + r.m, 0);
  const xg = rows.reduce((s, r) => s + r.m * r.x, 0) / M;
  const zg = rows.reduce((s, r) => s + r.m * r.z, 0) / M;

  const eq = equilibrium(hull, M, xg, zg);
  let speed = null, gz = null;
  if (eq.floats) {
    speed = speedPredict(hull, eq, { D: dr.D, pitch: dr.pitch, rpm: dr.rpm, count: dr.count });
    gz = gzCurve(hull, M, zg, 60);
  }

  return {
    hull, L, B, D, wall, sp, kit, comps, rows, M, xg, zg, eq, speed, gz,
    mShell, mFrames, mDeck, mLacq, hullMass, mComps, mBall, xBall, zBall, mFits,
    fits, fitsAboard, shaftLine, rudder, xProp, zProp, rhoP, kPrint,
    morph: { full: state.full, transom: state.transom, bow: state.bow },
    Vfull: hullVolume(hull),
  };
}

/* ---------- сборка для 3D-вида и экспорта ----------
 * Возвращает группы деталей {name, color, tris (мм)}: корпус, крепления
 * на местах, компоненты-болванки, валы, гребные винты, балласт. */
function assemblyParts(r, opts) {
  const cut = opts && opts.cut;
  const res = { nst: 121, nzc: 57 };
  const hullHi = makeHull(state.proto, { L: r.L, B: r.B, D: r.D }, r.morph, res);
  let hullTris = hullMesh(hullHi, r.wall);
  if (cut) hullTris = hullTris.filter(t =>
    (t[0][1] + t[1][1] + t[2][1]) / 3 < 1.5);   // разрез: остаётся левый борт
  const parts = [{ name: 'Корпус', color: [0.62, 0.72, 0.78], tris: hullTris }];
  const colorOf = c => {
    if (/^(nano|esp32c3|hm10|hc05|mx1508|tp4056|buck)/.test(c.id)) return [0.19, 0.31, 0.63];
    if (/^motor/.test(c.id)) return [0.70, 0.22, 0.18];
    if (/servo/.test(c.id)) return [0.85, 0.45, 0.15];
    if (/batt|holder/.test(c.id)) return [0.72, 0.55, 0.15];
    return [0.45, 0.45, 0.48];
  };
  for (const c of r.comps) {
    const cx = c.x * 1000, cy = c.y * 1000, cz = c.z * 1000;
    let tris;
    if (c.shape === 'cyl') {
      tris = fMove(fRotY(fRing(0, 0, -c.Lmm / 2, c.Wmm / 2, 0, c.Lmm, 20), 90), cx, cy, cz);
    } else {
      tris = fBox(cx, cy, cz, c.Lmm, c.Wmm, c.Hmm);
    }
    parts.push({ name: c.name, color: colorOf(c), tris });
  }
  for (const f of r.fitsAboard) {
    parts.push({
      name: f.name, color: [0.09, 0.45, 0.38],
      tris: fMove(f.tris, f.place.x, f.place.y || 0, f.place.z),
    });
  }
  // валы (дейдвудные трубки Ø5) и гребные винты — диск по диаметру
  const dr = DRIVE[r.kit];
  for (const s of r.shaftLine) {
    const dx = (s.x2 - s.x1) * 1000, dz = (s.z2 - s.z1) * 1000;
    const len = Math.hypot(dx, dz);
    const ang = Math.atan2(dx, dz) * 180 / Math.PI; // от оси Z к оси X
    const tube = fMove(fRotY(fRing(0, 0, 0, 2.5, 0, len, 14), ang),
      s.x1 * 1000, s.y * 1000, s.z1 * 1000);
    parts.push({ name: 'Дейдвуд с валом', color: [0.5, 0.45, 0.25], tris: tube });
    const disk = fMove(fRotY(fRing(0, 0, -1.5, dr.D * 500, 0, 3, 24), 90),
      (s.x1 - 0.004) * 1000, s.y * 1000, s.z1 * 1000);
    parts.push({ name: 'Гребной винт', color: [0.75, 0.6, 0.2], tris: disk });
  }
  // балласт
  parts.push({
    name: 'Балласт', color: [0.25, 0.25, 0.28],
    tris: fBox(r.xBall * 1000, 0, r.zBall * 1000 + 5,
      Math.max(20, r.mBall * 1e6 / 6 / 300), 18, 10),
  });
  return parts;
}

/* ---------- проверки ---------- */
function checks(r) {
  const out = [];
  const add = (lvl, txt) => out.push({ lvl, txt });
  if (!r.eq.floats) { add('bad', 'Модель тонет: масса больше водоизмещения по палубу. Уменьшите балласт или увеличьте размеры.'); return out; }
  const F = r.eq.freeboard * 1000, D = r.D * 1000;
  if (F < 0.12 * D) add('bad', `Свободный борт всего ${F.toFixed(0)} мм (< 12 % высоты борта) — зальёт первой же волной.`);
  else if (F < 0.22 * D) add('warn', `Свободный борт ${F.toFixed(0)} мм — маловато, лучше ≥ ${(0.22 * D).toFixed(0)} мм: убавьте балласт или увеличьте высоту борта.`);
  else add('ok', `Свободный борт ${F.toFixed(0)} мм (${(100 * F / D).toFixed(0)} % высоты борта).`);
  const GMmm = r.eq.GMt * 1000, Bmm = r.B * 1000;
  if (GMmm < 0.02 * Bmm) add('bad', `Метацентрическая высота ${GMmm.toFixed(1)} мм — модель завалится. Опустите грузы, добавьте балласт в киль.`);
  else if (GMmm < 0.05 * Bmm) add('warn', `h = ${GMmm.toFixed(1)} мм (< 5 % ширины) — остойчивость на пределе, качка будет размашистой.`);
  else add('ok', `Метацентрическая высота h = ${GMmm.toFixed(1)} мм (${(100 * GMmm / Bmm).toFixed(0)} % ширины) — достаточно.`);
  const psi = r.eq.psiDeg;
  if (Math.abs(psi) > 2.5) add('bad', `Дифферент ${psi.toFixed(1)}° на ${psi > 0 ? 'нос' : 'корму'} — сместите грузы ${psi > 0 ? 'в корму' : 'в нос'}.`);
  else if (Math.abs(psi) > 1) add('warn', `Дифферент ${psi.toFixed(1)}° — заметен на глаз; подвиньте батарею ${psi > 0 ? 'в корму' : 'в нос'}.`);
  else add('ok', `Посадка почти на ровный киль (дифферент ${psi.toFixed(2)}°).`);
  // погружение винта
  const dr = DRIVE[r.kit];
  const propTop = r.zProp + dr.D / 2;
  if (propTop > r.eq.Ta) add('warn', 'Верх диска винта у поверхности — винт может подсасывать воздух. Увеличьте осадку (балласт) или уменьшите диаметр винта.');
  else add('ok', `Гребной винт погружен: ось на ${(1000 * (r.eq.Ta - r.zProp)).toFixed(0)} мм ниже кормовой ватерлинии.`);
  // компоненты в корпусе
  const bad = [];
  for (const c of r.comps) {
    if (c.id === 'rudder_gear') continue; // баллер проходит сквозь корпус — это его работа
    if (c.z + c.Hmm / 2000 > r.D - 0.002) bad.push(c.name + ' (высота)');
    const st = r.hull.stations[Math.round(c.fx * (r.hull.stations.length - 1))];
    if (Math.abs(c.y) + c.Wmm / 2000 > yAt(st, Math.min(c.z, r.D)) - r.wall) bad.push(c.name + ' (ширина)');
  }
  if (bad.length) add('warn', 'Не помещаются в корпус: ' + [...new Set(bad)].join(', ') + ' — раздвиньте компоненты или увеличьте размеры.');
  else add('ok', 'Все компоненты умещаются под палубой и в обводах.');
  // запас плавучести
  const res = 100 * (r.Vfull / (r.M / RHO_W) - 1);
  add(res > 60 ? 'ok' : 'warn', `Запас плавучести ${res.toFixed(0)} % (объём по палубу против объёмного водоизмещения).`);
  if (r.L * 1000 > 256) add('info', `Корпус ${(r.L * 1000).toFixed(0)} мм длиннее стола большинства принтеров (250 мм) — печать двумя секциями со стыком по шпангоуту (см. «Печать и сборка»).`);
  return out;
}

/* ---------- отрисовка ---------- */
function svgOpen(w, h) { return `<svg class="geo-board" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`; }

function drawSide(r) {
  const W = 940, H = 360, mL = 50, mB = 40;
  const s = Math.min((W - 2 * mL) / r.L, (H - 2 * mB) / (r.D * 1.35));
  const X = x => mL + x * s, Z = z => H - mB - z * s;
  const st = r.hull.stations;
  let d = `M ${X(0)} ${Z(st[0].pts[0].z)} `;
  for (const q of st) d += `L ${X(q.x)} ${Z(q.pts[0].z)} `;           // киль
  d += `L ${X(r.L)} ${Z(r.D)} `;                                       // форштевень
  let dd = `M ${X(0)} ${Z(r.D)} L ${X(r.L)} ${Z(r.D)}`;                // палуба
  let out = svgOpen(W, H);
  out += `<path d="${d}" fill="none" stroke="#16161a" stroke-width="2"/>`;
  out += `<path d="${dd}" stroke="#16161a" stroke-width="2"/>`;
  out += `<line x1="${X(0)}" y1="${Z(st[0].pts[0].z)}" x2="${X(0)}" y2="${Z(r.D)}" stroke="#16161a" stroke-width="2"/>`;
  if (r.eq.floats) { // ватерлиния с дифферентом
    out += `<line x1="${X(-0.02 * r.L)}" y1="${Z(r.eq.Ta)}" x2="${X(1.02 * r.L)}" y2="${Z(r.eq.Tf)}" stroke="#2b4fa0" stroke-width="1.6" stroke-dasharray="8 5"/>`;
    out += `<text x="${X(1.02 * r.L)}" y="${Z(r.eq.Tf) - 6}" class="lbl-dim" fill="#2b4fa0" text-anchor="end">ВЛ</text>`;
  }
  // вал и винт
  for (const sh of r.shaftLine) {
    out += `<line x1="${X(sh.x1)}" y1="${Z(sh.z1)}" x2="${X(sh.x2)}" y2="${Z(sh.z2)}" stroke="#6b6b74" stroke-width="2.5"/>`;
    out += `<circle cx="${X(sh.x1)}" cy="${Z(sh.z1)}" r="${DRIVE[r.kit].D / 2 * s}" fill="none" stroke="#0e6b5e" stroke-width="2"/>`;
  }
  if (r.rudder) {
    const rx = X(r.rudder.x), rw = r.rudder.chord / 1000 * s, rh = r.rudder.span / 1000 * s;
    out += `<rect x="${rx - rw / 2}" y="${Z(r.eq.floats ? r.eq.Ta : r.D / 2) - 2}" width="${rw}" height="${rh}" rx="3" fill="none" stroke="#b3382e" stroke-width="2"/>`;
  }
  // компоненты: нумерованные плашки
  let n = 0;
  for (const c of r.comps) {
    if (c.twin && c.y < 0) continue; // на боку близнецы совпадают
    n++;
    const cw = c.Lmm / 1000 * s, ch = c.Hmm / 1000 * s;
    const cx = X(c.x) - cw / 2, cy = Z(c.z) - ch / 2;
    out += `<g class="comp" data-id="${c.id}" style="cursor:ew-resize">` +
      `<rect x="${cx}" y="${cy}" width="${Math.max(6, cw)}" height="${Math.max(5, ch)}" rx="2" fill="#0e6b5e18" stroke="#0e6b5e" stroke-width="1.4"/>` +
      `<text x="${cx + Math.max(6, cw) / 2}" y="${cy - 4}" class="lbl-dim" text-anchor="middle">${n}</text></g>`;
    c.tag = n;
  }
  // балласт
  const bw = Math.max(10, r.mBall * 4e4 * s / 1000), bx = X(r.xBall) - bw / 2, bz = Z(r.zBall);
  out += `<g class="comp" data-id="__ballast" style="cursor:ew-resize"><rect x="${bx}" y="${bz - 4}" width="${bw}" height="8" fill="#3a3a42" rx="2"/>` +
    `<text x="${bx + bw / 2}" y="${bz - 8}" class="lbl-dim" text-anchor="middle">Б</text></g>`;
  // ЦТ и ЦВ
  out += marker(X(r.xg), Z(r.zg), '#b3382e', 'ЦТ');
  if (r.eq.floats) out += marker(X(r.eq.h.xb), Z(r.eq.h.zb), '#2b4fa0', 'ЦВ');
  out += `<text x="${mL}" y="18" class="lbl-dim">Бок: компоновка (тяните плашки вдоль корпуса; Б — балласт)</text>`;
  out += '</svg>';
  return { out, scale: s, mL, X0: mL };
}
function marker(x, y, col, t) {
  return `<g><circle cx="${x}" cy="${y}" r="5" fill="none" stroke="${col}" stroke-width="1.6"/>` +
    `<line x1="${x - 5}" y1="${y}" x2="${x + 5}" y2="${y}" stroke="${col}" stroke-width="1.2"/>` +
    `<line x1="${x}" y1="${y - 5}" x2="${x}" y2="${y + 5}" stroke="${col}" stroke-width="1.2"/>` +
    `<text x="${x + 8}" y="${y - 6}" class="lbl-dim" fill="${col}">${t}</text></g>`;
}

function drawPlan(r) {
  const W = 940, H = 260, mL = 50, mV = 30;
  const s = Math.min((W - 2 * mL) / r.L, (H - 2 * mV) / r.B);
  const X = x => mL + x * s, Y = y => H / 2 - y * s;
  let out = svgOpen(W, H);
  out += `<line x1="${X(0)}" y1="${H / 2}" x2="${X(r.L)}" y2="${H / 2}" stroke="#9a9aa2" stroke-width="1" stroke-dasharray="12 4 3 4"/>`;
  const levels = r.eq.floats ? [0.5 * r.eq.T, r.eq.T] : [r.D * 0.25, r.D * 0.5];
  const cols = ['#8fb8c9', '#2b4fa0'];
  levels.forEach((zl, i) => {
    for (const sgn of [1, -1]) {
      let d = '';
      r.hull.stations.forEach((st, k) => {
        d += (k ? 'L' : 'M') + ' ' + X(st.x) + ' ' + Y(sgn * yAt(st, zl)) + ' ';
      });
      out += `<path d="${d}" fill="none" stroke="${cols[i]}" stroke-width="1.5"/>`;
    }
  });
  for (const sgn of [1, -1]) { // палуба
    let d = '';
    r.hull.stations.forEach((st, k) => {
      d += (k ? 'L' : 'M') + ' ' + X(st.x) + ' ' + Y(sgn * st.pts[st.pts.length - 1].y) + ' ';
    });
    out += `<path d="${d}" fill="none" stroke="#16161a" stroke-width="2"/>`;
  }
  out += `<line x1="${X(0)}" y1="${Y(r.hull.stations[0].pts[r.hull.stations[0].pts.length - 1].y)}" x2="${X(0)}" y2="${Y(-r.hull.stations[0].pts[r.hull.stations[0].pts.length - 1].y)}" stroke="#16161a" stroke-width="2"/>`;
  out += `<text x="${mL}" y="18" class="lbl-dim">Полуширота: палуба, ватерлинии (голубая — половинная осадка, синяя — ватерлиния)</text>`;
  out += '</svg>';
  return out;
}

function drawBody(r) {
  const W = 480, H = 330, m = 42;
  const s = Math.min((W / 2 - m) / (r.B / 2), (H - 2 * m) / r.D);
  const Y = y => W / 2 + y * s, Z = z => H - m - z * s;
  let out = svgOpen(W, H);
  out += `<line x1="${W / 2}" y1="${Z(0) + 12}" x2="${W / 2}" y2="${Z(r.D) - 8}" stroke="#9a9aa2" stroke-width="1" stroke-dasharray="12 4 3 4"/>`;
  const N = r.hull.stations.length - 1;
  for (let i = 0; i <= 10; i++) {
    const st = r.hull.stations[Math.round(i / 10 * N)];
    const aft = i <= 5; // кормовые — влево, носовые — вправо
    const sgn = aft ? -1 : 1;
    let d = '';
    st.pts.forEach((p, k) => { d += (k ? 'L' : 'M') + ' ' + Y(sgn * p.y) + ' ' + Z(p.z) + ' '; });
    out += `<path d="${d}" fill="none" stroke="${aft ? '#0e6b5e' : '#16161a'}" stroke-width="1.4"/>`;
  }
  if (r.eq.floats) {
    out += `<line x1="${Y(-r.B / 2) - 6}" y1="${Z(r.eq.T)}" x2="${Y(r.B / 2) + 6}" y2="${Z(r.eq.T)}" stroke="#2b4fa0" stroke-width="1.4" stroke-dasharray="8 5"/>`;
  }
  out += `<text x="${m}" y="16" class="lbl-dim">Корпус: корма</text>`;
  out += `<text x="${W - m}" y="16" class="lbl-dim" text-anchor="end">нос</text>`;
  out += '</svg>';
  return out;
}

function drawGZ(r) {
  const W = 480, H = 240, mL = 46, mB = 30;
  let out = svgOpen(W, H);
  if (!r.gz) return out + '</svg>';
  const gzmax = Math.max(1e-4, ...r.gz.map(p => Math.abs(p.gz)));
  const X = d => mL + d / 60 * (W - mL - 14), Y = g => H - mB - (g / gzmax) * (H - mB - 34) * 0.9;
  out += `<line x1="${mL}" y1="${Y(0)}" x2="${W - 10}" y2="${Y(0)}" stroke="#6b6b74" stroke-width="1.2" marker-end="url(#arrE)"/>`;
  out += `<line x1="${mL}" y1="${H - 8}" x2="${mL}" y2="${14}" stroke="#6b6b74" stroke-width="1.2" marker-end="url(#arrE)"/>`;
  let d = '';
  r.gz.forEach((p, i) => { d += (i ? 'L' : 'M') + ' ' + X(p.deg) + ' ' + Y(p.gz) + ' '; });
  out += `<path d="${d}" fill="none" stroke="#0e6b5e" stroke-width="2"/>`;
  const de = r.gz.find(p => p.deckEdge);
  if (de) out += `<circle cx="${X(de.deg)}" cy="${Y(de.gz)}" r="4" fill="#b3382e"/>` +
    `<text x="${X(de.deg)}" y="${Y(de.gz) - 8}" class="lbl-dim" fill="#b3382e" text-anchor="middle">палуба в воде</text>`;
  for (const t of [15, 30, 45, 60]) out += `<text x="${X(t)}" y="${Y(0) + 16}" class="lbl-dim" text-anchor="middle">${t}°</text>`;
  out += `<text x="${mL + 4}" y="20" class="lbl-dim">l(θ), мм: ${ (gzmax * 1000).toFixed(1) } макс.</text>`;
  out += '</svg>';
  return out;
}

/* ---------- шаги решения ---------- */
function renderSteps(r) {
  const f = (v, d) => fmt(v, d === undefined ? 2 : d);
  const mm = v => fmt(v * 1000, 0);
  let s = '';
  s += `<details open><summary><b>1. Масса корпуса</b></summary>` +
    stepRow('m<sub>об</sub> = A·t·ρ·k', `${f(r.sp.A * 1e4, 0)} см² · ${f(r.wall * 1000, 1)} мм · ${r.rhoP / 1000} г/см³ · ${r.kPrint}`, fmt(r.mShell * 1000, 0) + ' г') +
    stepRow('m<sub>наб</sub> = 0,06·m<sub>об</sub> (флоры, кницы)', '', fmt(r.mFrames * 1000, 0) + ' г') +
    stepRow('Крепления и фундаменты (' + r.fitsAboard.length + ' печатных дет.)', '', fmt(r.mFits * 1000, 0) + ' г') +
    stepRow('m<sub>пал</sub> = A<sub>пал</sub>·t·ρ', `${f(r.sp.Adeck * 1e4, 0)} см² · ${f(r.wall * 1000, 1)} мм`, fmt(r.mDeck * 1000, 0) + ' г') +
    stepRow('m<sub>лак</sub> ≈ 100 г/м² · (2A + A<sub>пал</sub>)', '', fmt(r.mLacq * 1000, 0) + ' г') +
    stepRow('Компоненты (' + r.comps.length + ' поз.)', '', fmt(r.mComps * 1000, 0) + ' г') +
    stepRow('Балласт', '', fmt(r.mBall * 1000, 0) + ' г') +
    stepRow('Δ = Σm', '', '<b>' + fmt(r.M * 1000, 0) + ' г</b>') + `</details>`;
  if (!r.eq.floats) return s + '<p class="note">Равновесной осадки нет — модель тонет.</p>';
  const h = r.eq.h;
  s += `<details><summary><b>2. Посадка</b></summary>` +
    stepRow('V = Δ/ρ', `${fmt(r.M * 1000, 0)} г / 0,998 г/см³`, f(r.M / RHO_W * 1e6, 0) + ' см³') +
    stepRow('T (бисекция V(T) = V)', '', mm(r.eq.T) + ' мм') +
    stepRow('F = D − T', `${mm(r.D)} − ${mm(r.eq.T)}`, mm(r.eq.freeboard) + ' мм') +
    stepRow('C<sub>B</sub> = V/(L<sub>ВЛ</sub>·B<sub>ВЛ</sub>·T)', `${f(h.V * 1e6, 0)}/(${mm(h.Lwl)}·${mm(h.Bwl)}·${mm(r.eq.T)})`, f(h.Cb)) +
    stepRow('C<sub>M</sub>, C<sub>P</sub>, C<sub>ВЛ</sub>', '', `${f(h.Cm)}, ${f(h.Cp)}, ${f(h.Cwp)}`) + `</details>`;
  s += `<details><summary><b>3. Остойчивость</b></summary>` +
    stepRow('z<sub>c</sub> (центр величины)', '', mm(h.zb) + ' мм') +
    stepRow('r = I<sub>x</sub>/V', `${fmt(h.Ix ? h.Ix * 1e12 : h.BMt * h.V * 1e12, 0)} мм⁴ / ${f(h.V * 1e9, 0)} мм³`, mm(h.BMt) + ' мм') +
    stepRow('z<sub>m</sub> = z<sub>c</sub> + r', `${mm(h.zb)} + ${mm(h.BMt)}`, mm(h.KMt) + ' мм') +
    stepRow('z<sub>g</sub> (по таблице нагрузки)', '', mm(r.zg) + ' мм') +
    stepRow('h = z<sub>m</sub> − z<sub>g</sub>', `${mm(h.KMt)} − ${mm(r.zg)}`, '<b>' + fmt(r.eq.GMt * 1000, 1) + ' мм</b>') +
    stepRow('Проверка кренованием: груз 20 г на планшире', `θ = arctg(m·b/(Δ·h)) = arctg(20·${mm(r.B / 2)}/(${fmt(r.M * 1000, 0)}·${fmt(r.eq.GMt * 1000, 1)}))`,
      fmt(Math.atan(0.02 * (r.B / 2) / (r.M * r.eq.GMt)) * 180 / Math.PI, 1) + '°') + `</details>`;
  s += `<details><summary><b>4. Дифферент</b></summary>` +
    stepRow('H = z<sub>c</sub> + R − z<sub>g</sub>', `${mm(h.zb)} + ${mm(h.BMl)} − ${mm(r.zg)}`, mm(r.eq.GMl) + ' мм') +
    stepRow('tg ψ = (x<sub>g</sub> − x<sub>c</sub>)/H', `(${mm(r.xg)} − ${mm(h.xb)})/${mm(r.eq.GMl)}`, fmt(r.eq.psiDeg, 2) + '°') +
    stepRow('T<sub>Н</sub> / T<sub>К</sub>', '', `${mm(r.eq.Tf)} / ${mm(r.eq.Ta)} мм`) + `</details>`;
  if (r.speed) {
    const sp = r.speed, dr = DRIVE[r.kit];
    s += `<details><summary><b>5. Скорость (оценка)</b></summary>` +
      stepRow('Винт', '', `${dr.count}×Ø${dr.D * 1000} мм, шаг ${dr.pitch * 1000} мм, ${dr.rpm} об/с (${dr.motor})`) +
      stepRow('Re = V·L<sub>ВЛ</sub>/ν', `${f(sp.V)}·${f(h.Lwl)}/10⁻⁶`, fmtE(sp.Re, 2)) +
      stepRow('C<sub>F</sub> (ИТТК-57)', '0,075/(lg Re − 2)²', fmtE(sp.Cf, 2)) +
      stepRow('Fr = V/√(gL)', `${f(sp.V)}/√(9,81·${f(h.Lwl)})`, f(sp.Fn)) +
      stepRow('C<sub>R</sub>(Fr) по типу обводов', '', fmtE(sp.Cr, 2)) +
      stepRow('R = (C<sub>F</sub>(1+k)+C<sub>A</sub>+C<sub>R</sub>)·½ρSV²', '', fmt(sp.R * 1000, 0) + ' мН') +
      stepRow('Упор T = K<sub>T</sub>·ρ·n²·D⁴ (равновесие T = R)', '', fmt(sp.Tprop * 1000, 0) + ' мН') +
      stepRow('V', '', '<b>' + f(sp.V) + ' м/с (' + f(sp.V * 3.6, 1) + ' км/ч)</b>') +
      stepRow('Время хода t = C/I', `${DRIVE[r.kit].cap} А·ч / ${DRIVE[r.kit].amp} А`, fmt(DRIVE[r.kit].cap / DRIVE[r.kit].amp, 1) + ' ч') +
      `<div class="note" style="margin-top:6px">Оценка с допущениями: линейная кривая K<sub>T</sub>, обороты под нагрузкой ≈ 70 % холостых, C<sub>R</sub> — по типовой кривой для выбранных обводов. Точность ±30 % — сверьте на ходовых испытаниях.</div></details>`;
  }
  return s;
}

/* ---------- интерфейс ---------- */
function bind(id, key, isFloat) {
  const el = $(id);
  if (!el) return;
  el.addEventListener('input', () => {
    state[key] = isFloat ? parseFloat(el.value) : el.value;
    const lab = $(id + '_v');
    if (lab) lab.textContent = el.value;
    refresh();
  });
}

let cur = null;
function refresh() {
  cur = compute();
  const r = cur;
  // живые показания
  const cells = [
    ['Водоизмещение', fmt(r.M * 1000, 0) + ' г'],
    ['Осадка', r.eq.floats ? fmt(r.eq.T * 1000, 0) + ' мм' : '—'],
    ['Свободный борт', r.eq.floats ? fmt(r.eq.freeboard * 1000, 0) + ' мм' : '—'],
    ['Метацентрич. высота', r.eq.floats ? fmt(r.eq.GMt * 1000, 1) + ' мм' : '—'],
    ['Дифферент', r.eq.floats ? fmt(r.eq.psiDeg, 2) + '°' : '—'],
    ['C<sub>B</sub>', r.eq.floats ? fmt(r.eq.h.Cb, 3) : '—'],
    ['Скорость (оценка)', r.speed ? fmt(r.speed.V, 2) + ' м/с' : '—'],
    ['Время хода', fmt(DRIVE[r.kit].cap / DRIVE[r.kit].amp, 1) + ' ч'],
  ];
  $('live').innerHTML = cells.map(c => `<div class="cellbox"><div class="k">${c[0]}</div><div class="v">${c[1]}</div></div>`).join('');
  // проверки
  $('checks').innerHTML = checks(r).map(c => {
    const ico = { ok: '✔', warn: '⚠', bad: '✖', info: 'ℹ' }[c.lvl];
    const col = { ok: '#1d7a3e', warn: '#b07a1e', bad: '#b3382e', info: '#2b4fa0' }[c.lvl];
    return `<div style="margin:4px 0"><span style="color:${col};font-weight:700">${ico}</span> ${c.txt}</div>`;
  }).join('');
  // чертежи
  const side = drawSide(r);
  $('side').innerHTML = side.out;
  $('plan').innerHTML = drawPlan(r);
  $('bodyplan').innerHTML = drawBody(r);
  $('gzplot').innerHTML = drawGZ(r);
  // легенда компоновки
  const seen = new Set();
  $('legend').innerHTML = '<table><tr><th>№</th><th>Компонент</th><th>Масса, г</th><th>x от транца, мм</th></tr>' +
    r.comps.filter(c => { if (seen.has(c.id)) return false; seen.add(c.id); return true; })
      .map(c => `<tr><td>${c.tag || ''}</td><td>${c.name}${c.twin ? ' ×2' : ''}</td><td>${fmt(c.mass * 1000 * (c.twin ? 2 : 1), 0)}</td><td>${fmt(c.x * 1000, 0)}</td></tr>`).join('') +
    `<tr><td>Б</td><td>Балласт (свинец/гайки в киль)</td><td>${fmt(r.mBall * 1000, 0)}</td><td>${fmt(r.xBall * 1000, 0)}</td></tr></table>`;
  // крепления и оснастка
  if ($('fitlist')) {
    $('fitlist').innerHTML = '<table><tr><th>Деталь</th><th>Габарит, мм</th><th>Масса, г</th><th>Где стоит</th></tr>' +
      r.fits.map(f => `<tr><td>${f.name}</td><td>${f.dims.map(d => d.toFixed(0)).join('×')}</td>` +
        `<td>${fmt(f.mass, 1)}</td><td>${f.place ? 'x = ' + fmt(f.place.x, 0) + ' мм' : 'на берегу (в массу не входит)'}</td></tr>`).join('') +
      `</table><p class="note">Печатных деталей ${r.fits.length}, на борту ${fmt(r.mFits * 1000, 0)} г —
       уже учтены в нагрузке масс. Подробно про каждую — на странице
       <a href="fittings">«Крепления и оснастка»</a>.</p>`;
  }
  $('steps').innerHTML = renderSteps(r);
  attachDrag(side);
  schedule3d();
  const info = PROTOS[state.proto];
  $('protoAbout').textContent = info.about + ' Набор электроники: «' + (partsDb().kits[r.kit] || {}).title + '».';
  try { localStorage.setItem('modelboat-state', JSON.stringify(state)); } catch (e) { }
}

/* перетаскивание компоновки: плашки двигаются вдоль x */
function attachDrag(side) {
  const svg = $('side').querySelector('svg');
  if (!svg) return;
  let target = null;
  const fxOf = ev => {
    const pt = svg.createSVGPoint();
    pt.x = (ev.touches ? ev.touches[0].clientX : ev.clientX);
    pt.y = (ev.touches ? ev.touches[0].clientY : ev.clientY);
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    return clamp((p.x - side.X0) / side.scale / cur.L, 0.03, 0.95);
  };
  svg.addEventListener('pointerdown', ev => {
    const g = ev.target.closest('.comp');
    if (!g) return;
    target = g.dataset.id;
    svg.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  });
  svg.addEventListener('pointermove', ev => {
    if (!target) return;
    const fx = fxOf(ev);
    if (target === '__ballast') { state.ballastFx = fx; $('ballastFx').value = fx; }
    else state.pos[target] = fx;
    refresh();
  });
  svg.addEventListener('pointerup', () => { target = null; });
}

/* ---------- 3D-вид ---------- */
let viewer = null, t3d = null;
function schedule3d() {
  if (!$('view3d')) return;
  clearTimeout(t3d);
  t3d = setTimeout(update3d, 450);
}
function update3d() {
  const cv = $('view3d');
  if (!cv || typeof viewer3d !== 'function') return;
  if (!viewer) { viewer = viewer3d(cv); window._v3d = viewer; }
  if (!viewer) return;
  const r = cur || compute();
  viewer.setParts(assemblyParts(r, { cut: $('cut3d') && $('cut3d').checked }));
}

/* ---------- экспорт ---------- */
function doExport(kind) {
  const r = cur || compute();
  const nm = 'boat-' + state.proto + '-' + state.L;
  if (kind === 'stl') { // корпус в высоком разрешении (гладкий, водонепроницаемый)
    const hi = makeHull(state.proto, { L: r.L, B: r.B, D: r.D }, r.morph, { nst: 121, nzc: 57 });
    download(stlBlob(hullMesh(hi, r.wall)), nm + '.stl');
  }
  if (kind === 'fit') download(stlBlob(fittingsMesh(r.fits)), nm + '-крепления.stl');
  if (kind === 'asm') {
    const all = [];
    for (const p of assemblyParts(r, {})) all.push(...p.tris);
    download(stlBlob(all), nm + '-сборка.stl');
  }
  if (kind === 'json') {
    const spec = boatJson({ name: nm, kit: r.kit, T: r.eq.floats ? r.eq.T : 0, wall: r.wall },
      r.hull, r.comps, r.shaftLine, r.rudder);
    // крепления — в сборку КОМПАС болванками по габаритам
    spec.components = spec.components.concat(r.fitsAboard.map(f => ({
      id: f.id, name: f.name, x: +f.place.x.toFixed(1), y: +(f.place.y || 0).toFixed(1),
      z: +(f.place.z + f.dims[2] / 2).toFixed(1),
      L: +f.dims[0].toFixed(1), W: +f.dims[1].toFixed(1), H: +f.dims[2].toFixed(1),
      shape: 'box',
    })));
    download(new Blob([JSON.stringify(spec, null, 1)], { type: 'application/json' }), 'boat.json');
  }
  if (kind === 'csv') download(offsetsCsv(r.hull), nm + '-ординаты.csv');
}

/* ---------- запуск ---------- */
window.addEventListener('DOMContentLoaded', () => {
  try {
    const saved = JSON.parse(localStorage.getItem('modelboat-state') || 'null');
    if (saved && saved.proto) Object.assign(state, saved);
  } catch (e) { }
  for (const [id, key, fl] of [
    ['L', 'L', true], ['LB', 'LB', true], ['DB', 'DB', true],
    ['full', 'full', true], ['transom', 'transom', true], ['bow', 'bow', true],
    ['wall', 'wall', true], ['ballast', 'ballast', true], ['ballastFx', 'ballastFx', true]]) {
    const el = $(id);
    if (el) { el.value = state[key]; const lab = $(id + '_v'); if (lab) lab.textContent = el.value; }
    bind(id, key, fl);
  }
  $('proto').value = state.proto;
  $('proto').addEventListener('change', () => { state.proto = $('proto').value; state.pos = {}; refresh(); });
  $('mat').value = state.mat;
  $('mat').addEventListener('change', () => { state.mat = $('mat').value; refresh(); });
  $('reset').addEventListener('click', () => { state.pos = {}; refresh(); });
  for (const k of ['stl', 'fit', 'asm', 'json', 'csv'])
    if ($('exp_' + k)) $('exp_' + k).addEventListener('click', () => doExport(k));
  if ($('cut3d')) $('cut3d').addEventListener('change', update3d);
  const views = { v34: [2.7, -0.7, 1.5], vside: [3.14, -1.35, 1.7], vtop: [3.14, -0.12, 1.6] };
  for (const id in views)
    if ($(id)) $(id).addEventListener('click', () => { if (viewer) viewer.setView(...views[id]); });
  refresh();
});
