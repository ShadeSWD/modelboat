/* Конструктор модели: связывает ползунки, расчётное ядро (hull.js),
 * базу компонентов (parts.js), крепления (fittings.js) и чертежи.
 * Внутри всё в СИ (метры, килограммы), на экране мм и г.
 *
 * Компоновка строится «стеком»: днище → подошва крепления → крепление →
 * компонент; платы живут в карманах салазок и двигаются вместе с ними.
 * Тянуть можно якоря: мотор, салазки, батарею, серво, выключатель, балласт. */
'use strict';

/* ---------- запасная база компонентов (если parts.js не загрузился) ---------- */
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
    micro: { title: 'Микро (двухвальный)', parts: [] },
    classic: { title: 'Классика (одновальный с рулём)', parts: [] },
  },
};
function partsDb() { return (typeof PARTS_DB !== 'undefined') ? PARTS_DB : FALLBACK_DB; }

/* винтомоторные данные наборов */
const DRIVE = {
  micro: { D: 0.030, pitch: 0.034, rpm: 40, count: 2, amp: 0.9, cap: 2.6, motor: 'два N20' },
  classic: { D: 0.035, pitch: 0.042, rpm: 95, count: 1, amp: 1.6, cap: 2.6, motor: 'мотор 130' },
};

/* слоты салазок (платы от кормы к носу) */
const SLED = {
  classic: ['mx1508', 'buck_mini360', 'nano', 'hm10'],
  micro: ['mx1508', 'esp32c3', 'tp4056'],
};

const state = {
  proto: 'tug', L: 450, LB: 5.2, DB: 0.85,
  full: 1, transom: 1, bow: 1,
  wall: 1.6, mat: 'pla', ballast: 350, ballastFx: 0.48,
  pos: {},          // переопределённые пользователем x (доли L) по якорям
};
function kitOf() { return PROTOS[state.proto].shafts === 2 ? 'micro' : 'classic'; }

/* ---------- полный пересчёт ---------- */
function compute() {
  const L = state.L / 1000, B = L / state.LB, D = B * state.DB;
  const hull = makeHull(state.proto, { L, B, D },
    { full: state.full, transom: state.transom, bow: state.bow });
  const wall = state.wall / 1000;
  const rhoP = state.mat === 'petg' ? 1270 : 1240;
  const sp = shellProps(hull);
  const db = partsDb(), kit = kitOf();
  const P = db.parts;
  const twin = PROTOS[state.proto].shafts === 2;
  const dr = DRIVE[kit];
  const LM = L * 1000;

  // масса корпуса
  const kPrint = 1.07;
  const mShell = sp.A * wall * rhoP * kPrint;
  const mFrames = 0.06 * mShell;                 // флоры и кницы
  const mLacq = (2 * sp.A + sp.Adeck) * 0.10;    // лак ≈100 г/м²

  /* --- якоря компоновки (мм от транца); дефолты пакуются без пересечений --- */
  const fx = (key, def) => (state.pos[key] !== undefined ? state.pos[key] : def) * L;
  const sledSlots = SLED[kit].map(id => ({
    id, L: P[id].L, W: P[id].W, H: P[id].H, short: P[id].name.split(' ')[0],
  }));
  const sledLen = sledSlots.reduce((s, sl) => s + sl.L + 5, 5) + 4.8;
  const sledW = Math.max(...sledSlots.map(s => s.W)) + 7;
  const motorL = twin ? P.motor_n20.L : P.motor_130.L;
  const battL = (twin ? P.holder_1x18650.L : P.holder_2x18650.L) + 6;
  /* --- первый проход равновесия (грубо, для линии вала и пера) --- */
  const massRough = mShell + mFrames + sp.Adeck * wall * rhoP + mLacq + 0.35;
  const eq0 = equilibrium(hull, massRough, 0.47 * L, 0.4 * D);
  const T0 = eq0.floats ? eq0.T : 0.5 * D;

  /* --- винт и руль ПОД корпусом (классическая схема) ---
   * Винт стоит под кормовым подзором (у двухвального — под скулой на
   * своей полуширине), перо руля — за винтом, баллер идёт сквозь подзор
   * (гельмпорт). Чтобы винт никогда не резал обшивку, его диаметр
   * ВПИСЫВАЕТСЯ в апертуру: верх диска на 1,5 мм ниже местной обшивки,
   * низ — не глубже 15 % осадки под ОП (одновальный) или 50 % (двухвальный,
   * как у прототипа Athena — винты на кронштейнах ниже днища). */
  const bottomLocal = (xM, yM) => {
    const st = hull.stations[Math.max(0, Math.min(hull.stations.length - 1,
      Math.round(xM / L * (hull.stations.length - 1))))];
    if (Math.abs(yM) < 1e-6) return st.pts[0].z;
    for (let k = 0; k < st.pts.length; k++)
      if (st.pts[k].y >= Math.abs(yM)) return st.pts[k].z;
    return st.pts[0].z;
  };
  const twinYm = 0.13 * B; // двухвальному валы ближе к ДП — там глубже
  const chordM = 0.062 * L;
  const yPropM = twin ? twinYm : 0;
  const dipLim = (twin ? 0.5 : 0.15) * T0;
  let xPropV = (twin ? 0.05 : 0.075) * L, Rp = dr.D / 2;
  for (let it = 0; it < 3; it++) { // диаметр и позиция сходятся за пару итераций
    const bl = bottomLocal(xPropV, yPropM);
    Rp = Math.max(0.008, Math.min(dr.D / 2, (bl - 0.0015 + dipLim) / 2));
    if (!twin) { // перед пером руля должно остаться место до транца
      const need = 0.008 + 0.35 * chordM + 0.002 + Rp;
      if (xPropV < need) xPropV = need;
    }
  }
  const xProp = xPropV;
  const zProp = bottomLocal(xProp, yPropM) - 0.0015 - Rp;
  const DpEff = 2 * Rp; // фактический диаметр винта, вписанный под корпус
  const pitchEff = dr.pitch * DpEff / dr.D; // шаг покупного винта ~пропорционален

  /* --- мотор: ось на линии вала, наклон не больше 15° (прямая муфта);
   * если корпус короток и цепочка не помещается — мотор сдвигается
   * к корме, наклон растёт и конструктор предупреждает про кардан --- */
  const AXISH = { classic: 24.4, micro: 7.0 };   // высота оси над площадкой фундамента, мм
  let motorDefF = twin ? 0.24 : 0.30;
  const zMotAt = mF => Math.max(
    bottomLocal(mF * L, yPropM) + wall + 0.006 + AXISH[kit] / 1000, zProp + 0.004);
  for (let it = 0; it < 3; it++) {
    const minX = xProp + (zMotAt(motorDefF) - zProp) / Math.tan(15 * Math.PI / 180);
    motorDefF = Math.max(motorDefF, Math.min(0.5, minX / L));
  }
  const chain = mF => {
    const bF = (mF * LM + motorL / 2 + 8 + battL / 2) / LM;
    const sF = bF + (battL / 2 + 10 + sledLen / 2) / LM;
    return { sF, bF, end: sF + (sledLen / 2 + 6) / LM };
  };
  const motorAngleMinF = motorDefF; // ниже — наклон вала превысит 15°
  let ch = chain(motorDefF);
  let tooShort = false;
  if (ch.end > 0.93) { // корпус короток: мотор не трогаем (угол!), тесноту честно покажем
    tooShort = true;
    ch = chain(motorAngleMinF);
  }
  // салазкам нужно место по ширине: сдвигаем дефолт из узкого носа к миделю
  const yInQuick = (xM, zM) => {
    const st = hull.stations[Math.max(0, Math.min(hull.stations.length - 1,
      Math.round(xM / L * (hull.stations.length - 1))))];
    return yAt(st, zM) - wall;
  };
  // высота площадки для детали [halfW × len] в точке f·L (грубый аналог
  // platformZ из fittings.js — для выбора дефолтных позиций)
  const platformQuick = (f, halfM, lenM) => {
    for (let z = 0.001; z < D; z += 0.001) {
      let ok = true;
      for (const xo of [-lenM / 2, 0, lenM / 2])
        if (yInQuick(f * L + xo, z) < halfM + 0.002) { ok = false; break; }
      if (ok) return z;
    }
    return D;
  };
  // серво: у кормы, но там, где помещается под палубой
  let servoDefF = 0.115;
  while (servoDefF < 0.5 &&
    platformQuick(servoDefF, 0.020, 0.038) + 0.031 > D - 0.003) servoDefF += 0.02;
  // батарея: как можно ближе к расчётному месту цепочки, но чтобы влезла
  const battHalfM = ((twin ? P.holder_1x18650.W : P.holder_2x18650.W) + 6) / 2000 + 0.002;
  const battHM = ((twin ? P.holder_1x18650.H : P.holder_2x18650.H) + P.batt_18650.H) / 1000;
  let battDefF = Math.min(0.84, ch.bF);
  while (battDefF > 0.35 &&
    platformQuick(battDefF, battHalfM, battL / 1000 + 0.024) + 0.002 + battHM > D - 0.002)
    battDefF -= 0.02;
  // салазки с направляющими не должны вылезать за форштевень
  const sledMaxF = (LM - (sledLen + 8) / 2 - 10) / LM;
  let sledDefF = Math.min(0.86, sledMaxF, ch.sF);
  const sledHalfM = (sledW / 2 + 10) / 1000;
  // салазки ищут место, где помещаются и по ширине, и по высоте
  // (корпус — железный приоритет; перекрытие с мотором лишь предупреждение)
  const sledHmax = Math.max(...sledSlots.map(sl => sl.H)) / 1000;
  const motorFm = (state.pos[twin ? 'motor_n20' : 'motor_130'] !== undefined
    ? state.pos[twin ? 'motor_n20' : 'motor_130'] : motorDefF);
  // поиск места салазок: сперва с обходом зоны мотора, если негде —
  // без обхода (корпус — железный приоритет, перекрытие лишь предупреждение)
  const sledScan = avoidMotor => {
    for (let f = Math.min(0.86, sledMaxF, ch.sF); f > 0.24; f -= 0.02) {
      if (avoidMotor && Math.abs(f * LM - motorFm * LM) < (motorL + sledLen) / 2 + 6) continue;
      let ok = true;
      for (const xo of [-sledLen / 2 - 4, 0, sledLen / 2 + 4])
        if (yInQuick(f * L + xo / 1000, 0.62 * D) < sledHalfM) { ok = false; break; }
      if (ok && platformQuick(f, sledHalfM, (sledLen + 8) / 1000) +
        0.006 + sledHmax > D + 0.003) ok = false;
      if (ok) return f;
    }
    return null;
  };
  sledDefF = sledScan(true);
  if (sledDefF === null) sledDefF = sledScan(false);
  if (sledDefF === null) sledDefF = Math.min(0.86, sledMaxF, ch.sF);
  const anchors = {
    servoX: fx('servo_sg90', servoDefF),
    motorX: fx(twin ? 'motor_n20' : 'motor_130', motorDefF),
    sledX: fx('__sled', sledDefF),
    battX: fx('holder', battDefF),
    switchX: fx('switch_kcd', (() => {
      let f = Math.min(0.9, ch.end + 0.035);
      while (f > 0.3 && yInQuick(f * L, D - 0.024) < (P.switch_kcd.W / 2 + 3) / 1000) f -= 0.02;
      return f;
    })()),
    wiresX: fx('wires', 0.33),
    ballastX: state.ballastFx * L,
    twinY: twinYm * 1000,
  };
  for (const k in anchors) if (k !== 'twinY') anchors[k] *= 1000; // в мм

  const zMot = zMotAt(anchors.motorX / 1000 / L);
  const shaftTiltDeg = Math.atan2(zMot - zProp, anchors.motorX / 1000 - xProp) * 180 / Math.PI;
  const shaftLine = [];
  for (let i = 0; i < (twin ? 2 : 1); i++) {
    shaftLine.push({
      x1: xProp, z1: zProp,
      x2: anchors.motorX / 1000, z2: zMot,
      y: twin ? (i === 0 ? 1 : -1) * anchors.twinY / 1000 : 0,
    });
  }
  // перо руля под подзором за винтом, верх у обшивки
  const rudder = PROTOS[state.proto].rudder ? (() => {
    const xR = xProp - Rp - 0.35 * chordM - 0.002;
    const zTop = (bottomLocal(xR, 0) - 0.001) * 1000;
    return {
      x: xR * 1000, chord: Math.round(chordM * 1000),
      span: Math.max(20, Math.round(zTop + 0.13 * T0 * 1000)), thick: 3,
      zTop,
    };
  })() : null;

  /* --- палуба: кромка борта и люк над отсеком аппаратуры --- */
  const deckPts = [];
  for (const st of hull.stations) deckPts.push({ x: st.x * 1000, y: st.pts[st.pts.length - 1].y * 1000 });
  const hatchX1 = Math.max(anchors.motorX - motorL / 2 - 10, 0.08 * LM);
  const hatchX2 = Math.min(anchors.battX + battL / 2 + 14, 0.8 * LM);
  const hatchHW = Math.max(16, Math.min(0.30 * B * 1000,
    Math.min(...hull.stations.filter(s => s.x * 1000 > hatchX1 && s.x * 1000 < hatchX2)
      .map(s => s.pts[s.pts.length - 1].y * 1000)) - wall * 1000 - 7));
  const hatch = { x1: hatchX1, x2: hatchX2, hw: hatchHW };

  /* --- крепления --- */
  let fits = [];
  if (typeof buildFittings === 'function') {
    fits = buildFittings({
      kit, parts: P, hullStations: hull.stations, L, B, D, wall,
      ballast: state.ballast, ballastFx: state.ballastFx,
      anchors, sledSlots, sledW,
      shaftTiltDeg, motorZtop: (zMot - AXISH[kit] / 1000) * 1000,
      rudder, prop: { D: Math.round(DpEff * 1000), P: Math.round(pitchEff * 1000) },
      shaftMM: shaftLine.map(s => ({
        x1: s.x1 * 1000, z1: s.z1 * 1000, x2: s.x2 * 1000, z2: s.z2 * 1000, y: s.y * 1000,
      })),
      deckPts, hatch,
    });
  }
  const fitById = id => fits.find(f => f.id === id);

  /* --- компоненты на посадочных местах креплений --- */
  const comps = [];
  const addComp = (id, xMM, yMM, zBotMM, extraName) => {
    const p = P[id];
    if (!p) return;
    comps.push({
      id, name: (extraName || p.name), x: xMM / 1000, y: yMM / 1000,
      z: (zBotMM + p.H / 2) / 1000, mass: p.mass / 1000,
      Lmm: p.L, Wmm: p.W, Hmm: p.H, shape: p.shape || 'box',
    });
  };
  // направление линии вала (от винта к мотору) и точка на ней
  const shDir = (() => {
    const dx = anchors.motorX / 1000 - xProp, dz = zMot - zProp;
    const l = Math.hypot(dx, dz);
    return { x: dx / l, z: dz / l };
  })();
  const onShaft = distFromMotor => ({
    x: anchors.motorX / 1000 - shDir.x * distFromMotor,
    z: zMot - shDir.z * distFromMotor,
  });
  if (kit === 'classic') {
    const fs = fitById('fit_servo'), fb = fitById('fit_batt');
    { // мотор осью на линии вала, наклонён вместе с фундаментом
      const p = P.motor_130;
      comps.push({
        id: 'motor_130', name: p.name, x: anchors.motorX / 1000, y: 0,
        z: zMot, mass: p.mass / 1000,
        Lmm: p.L, Wmm: p.W, Hmm: p.H, shape: 'cyl', rotY: -shaftTiltDeg,
      });
    }
    if (fs) addComp('servo_sg90', anchors.servoX, 0, fs.place.z + (fs.seat || 2));
    if (fb) {
      addComp('holder_2x18650', anchors.battX, 0, fb.place.z + (fb.seat || 2),
        P.holder_2x18650.name + ' + 2×' + P.batt_18650.name);
      const bi = comps[comps.length - 1];
      bi.mass += 2 * P.batt_18650.mass / 1000;
      bi.Hmm = P.holder_2x18650.H + P.batt_18650.H;
      bi.z = (fb.place.z + (fb.seat || 2) + bi.Hmm / 2) / 1000;
      bi.id = 'holder';
    }
    { // муфта — на линии вала, вплотную к мотору
      const c = onShaft((motorL / 2 + 8) / 1000);
      addComp('coupling', c.x * 1000, 0, 0);
      const cc = comps[comps.length - 1];
      cc.z = c.z; cc.shape = 'cyl'; cc.rotY = -shaftTiltDeg;
      cc.name = 'Муфта вала (стыкует мотор и вал напрямую)';
    }
    // качалка руля — у транца под самой палубой (баллер идёт снаружи через
    // гельмпорт; внутри торчит только головка с качалкой — её и рисуем);
    // в узкой корме сдвигается в нос, пока не поместится по ширине
    let rgX = 22;
    while (rgX < 80 && yInQuick(rgX / 1000, D - 0.020) < 0.013) rgX += 4;
    addComp('rudder_gear', rgX, 0, D * 1000 - 20);
    {
      const rg = comps[comps.length - 1];
      rg.Lmm = 20; rg.Wmm = 10; rg.Hmm = 14;
      rg.z = (D * 1000 - 13) / 1000;
    }
    // вал в массе есть, но в 3D его заменяет дейдвудная трубка по линии
    addComp('shaft_m2', onShaft(0.05).x * 1000, 0, onShaft(0.05).z * 1000);
    comps[comps.length - 1].draw = false;
    addComp('prop_35', xProp * 1000, 0, zProp * 1000 - P.prop_35.H / 2);
    comps[comps.length - 1].draw = false; // в 3D — лопастной винт
  } else {
    const fl = fitById('fit_motor_l'), fb = fitById('fit_batt');
    for (const sgn of [1, -1]) {
      const f = sgn > 0 ? fl : fitById('fit_motor_r');
      const p = P.motor_n20;
      comps.push({
        id: 'motor_n20', name: p.name, x: anchors.motorX / 1000, y: sgn * anchors.twinY / 1000,
        z: zMot, mass: p.mass / 1000,
        Lmm: p.L, Wmm: p.W, Hmm: p.H, shape: 'box', twin: true, rotY: -shaftTiltDeg,
      });
    }
    if (fb) {
      addComp('holder_1x18650', anchors.battX, 0, fb.place.z + (fb.seat || 2),
        P.holder_1x18650.name + ' + ' + P.batt_18650.name);
      const bi = comps[comps.length - 1];
      bi.mass += P.batt_18650.mass / 1000;
      bi.Hmm = P.holder_1x18650.H + P.batt_18650.H;
      bi.z = (fb.place.z + (fb.seat || 2) + bi.Hmm / 2) / 1000;
      bi.id = 'holder';
    }
    for (const s of shaftLine) {
      addComp('shaft_m2', onShaft(0.05).x * 1000, s.y * 1000, onShaft(0.05).z * 1000);
      comps[comps.length - 1].y = s.y;
      comps[comps.length - 1].draw = false;
      addComp('prop_30', s.x1 * 1000, s.y * 1000, s.z1 * 1000);
      comps[comps.length - 1].y = s.y;
      comps[comps.length - 1].draw = false;
      const c = onShaft((motorL / 2 + 2) / 1000);
      addComp('coupling', c.x * 1000, s.y * 1000, 0);
      const cc = comps[comps.length - 1];
      cc.y = s.y; cc.z = c.z; cc.shape = 'cyl'; cc.rotY = -shaftTiltDeg;
      cc.name = 'Муфта вала (стыкует мотор и вал напрямую)';
    }
  }
  // платы в карманах салазок
  const sled = fitById('fit_sled');
  if (sled) {
    sledSlots.forEach((sl, i) => {
      addComp(sl.id, anchors.sledX + sled.offsets[i], 0, sled.place.z + (sled.seat || 2));
    });
  }
  // выключатель и «рассыпуха»
  addComp('switch_kcd', anchors.switchX, 0,
    fitById('fit_deck') ? D * 1000 - P.switch_kcd.H - 4 : D * 1000 * 0.5);
  // провода и крепёж — россыпь по трюму: в массе есть, в 3D не рисуются
  addComp('wires', anchors.wiresX, 0, hullBotAt(hull, anchors.wiresX / 1000) * 1000 + wall * 1000 + 1);
  comps[comps.length - 1].draw = false;
  addComp('screws_m3', anchors.wiresX + 40, 0, hullBotAt(hull, anchors.wiresX / 1000 + 0.04) * 1000 + wall * 1000 + 1);
  comps[comps.length - 1].draw = false;

  const mComps = comps.reduce((s, c) => s + c.mass, 0);
  const mBall = state.ballast / 1000;
  const fb2 = fitById('fit_ballast');
  const zBall = ((fb2 ? fb2.place.z : 10) + (fb2 && fb2.ballH ? fb2.ballH / 2 : 5)) / 1000;

  /* --- нагрузка масс --- */
  const fitsAboard = fits.filter(f => f.place);
  const mFits = fitsAboard.reduce((s, f) => s + f.mass, 0) / 1000;
  const hasDeck = !!fitById('fit_deck');
  const mDeck = hasDeck ? 0 : sp.Adeck * wall * rhoP; // палуба теперь печатная деталь
  const rows = [
    { name: 'Оболочка корпуса', m: mShell, x: sp.x, z: sp.z },
    { name: 'Набор (флоры, кницы)', m: mFrames, x: sp.x, z: sp.z * 0.6 },
    { name: 'Лак', m: mLacq, x: sp.x, z: sp.z },
    ...comps.map(c => ({ name: c.name, m: c.mass, x: c.x, z: c.z })),
    { name: 'Балласт', m: mBall, x: anchors.ballastX / 1000, z: zBall },
    ...fitsAboard.map(f => ({
      name: f.name, m: f.mass / 1000,
      x: f.absolute ? 0.47 * L : f.place.x / 1000,
      z: (f.place.z + f.dims[2] / 2) / 1000, fit: true,
    })),
  ];
  if (mDeck) rows.splice(2, 0, { name: 'Палуба (оценка)', m: mDeck, x: sp.xdeck, z: D });
  const M = rows.reduce((s, r) => s + r.m, 0);
  const xg = rows.reduce((s, r) => s + r.m * r.x, 0) / M;
  const zg = rows.reduce((s, r) => s + r.m * r.z, 0) / M;

  const eq = equilibrium(hull, M, xg, zg);
  let speed = null, gz = null;
  if (eq.floats) {
    speed = speedPredict(hull, eq, { D: DpEff, pitch: pitchEff, rpm: dr.rpm, count: dr.count });
    gz = gzCurve(hull, M, zg, 60);
  }

  return {
    hull, L, B, D, wall, sp, kit, comps, rows, M, xg, zg, eq, speed, gz,
    mShell, mFrames, mDeck, mLacq, mComps, mBall, mFits,
    xBall: anchors.ballastX / 1000, zBall,
    fits, fitsAboard, shaftLine, rudder, xProp, zProp, DpEff, pitchEff, rhoP, kPrint,
    anchors, sledLen, hatch, hasDeck, tooShort, shaftTiltDeg,
    morph: { full: state.full, transom: state.transom, bow: state.bow },
    Vfull: hullVolume(hull),
  };
}
function hullBotAt(hull, xM) {
  const st = hull.stations[Math.max(0, Math.min(hull.stations.length - 1,
    Math.round(xM / hull.L * (hull.stations.length - 1))))];
  return st.pts[0].z;
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
  const propTop = r.zProp + r.DpEff / 2;
  if (propTop > r.eq.Ta) add('warn', 'Верх диска винта у поверхности — винт может подсасывать воздух. Увеличьте осадку (балласт) или уменьшите диаметр винта.');
  else add('ok', `Гребной винт погружен: ось на ${(1000 * (r.eq.Ta - r.zProp)).toFixed(0)} мм ниже кормовой ватерлинии.`);
  // компоненты в корпусе и не друг в друге
  const bad = [], clash = [];
  // валы/винты/тяги — не «коробки»; провода и крепёж лежат россыпью по трюму
  const boxes = r.comps.filter(c => !['rudder_gear', 'shaft_m2', 'prop_30', 'prop_35',
    'coupling', 'wires', 'screws_m3'].includes(c.id));
  for (const c of boxes) {
    if (c.z + c.Hmm / 2000 > r.D - 0.001) bad.push(c.name + ' (высота)');
    const st = r.hull.stations[Math.round(c.x / r.L * (r.hull.stations.length - 1))];
    if (Math.abs(c.y) + c.Wmm / 2000 > yAt(st, Math.min(c.z + c.Hmm / 2000, r.D)) - r.wall + 0.0005)
      bad.push(c.name + ' (ширина)');
  }
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    if (Math.abs(a.x - b.x) * 1000 < (a.Lmm + b.Lmm) / 2 - 0.5 &&
      Math.abs(a.y - b.y) * 1000 < (a.Wmm + b.Wmm) / 2 - 0.5 &&
      Math.abs(a.z - b.z) * 1000 < (a.Hmm + b.Hmm) / 2 - 0.5)
      clash.push(a.name.split(',')[0] + ' ↔ ' + b.name.split(',')[0]);
  }
  if (bad.length) add('warn', 'Не помещаются в корпус: ' + [...new Set(bad)].join(', ') + ' — раздвиньте компоненты или увеличьте размеры.');
  else add('ok', 'Все компоненты умещаются под палубой и в обводах.');
  if (clash.length) add('warn', 'Компоненты пересекаются: ' + [...new Set(clash)].join('; ') + ' — растащите якоря по длине.');
  else add('ok', 'Пересечений между компонентами нет.');
  // железная геометрическая проверка: вершины деталей против обшивки
  if (r.clearance) {
    if (r.clearance.length) {
      add('bad', 'Пересечение с корпусом: ' + r.clearance.slice(0, 3)
        .map(v => `${v.name.split('(')[0].trim()} (${v.where}${v.depth < 90 ? ', ' + v.depth.toFixed(1) + ' мм' : ''})`)
        .join('; ') + (r.clearance.length > 3 ? ` и ещё ${r.clearance.length - 3}` : '') +
        ' — подвиньте якоря или увеличьте размеры корпуса.');
    } else {
      add('ok', 'Железная проверка пройдена: ни одна вершина ни одной детали не выходит из корпуса.');
    }
  }
  if (r.tooShort) add('bad', `Корпус короток для набора «${r.kit === 'classic' ? 'Классика' : 'Микро'}»: цепочка мотор→батарея→платы не помещается без перекрытий. Увеличьте длину (для «Классики» — от ~420 мм).`);
  if (r.shaftTiltDeg > 16) add('warn', `Наклон линии вала ${r.shaftTiltDeg.toFixed(0)}° — прямая муфта не справится, нужен карданчик.`);
  const res = 100 * (r.Vfull / (r.M / RHO_W) - 1);
  add(res > 60 ? 'ok' : 'warn', `Запас плавучести ${res.toFixed(0)} % (объём по палубу против объёмного водоизмещения).`);
  if (r.L * 1000 > 256) add('info', `Корпус ${(r.L * 1000).toFixed(0)} мм длиннее стола большинства принтеров (250 мм) — печать двумя секциями со стыком по шпангоуту (см. «Печать и сборка»).`);
  return out;
}

/* ---------- отрисовка (плоские проекции) ---------- */
function svgOpen(w, h) { return `<svg class="geo-board" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`; }

/* какие якоря можно тянуть на боковой проекции */
const DRAGGABLE = {
  classic: { motor_130: 'М', __sled: 'П', holder: 'Б', servo_sg90: 'С', switch_kcd: 'В', wires: 'п' },
  micro: { motor_n20: 'М', __sled: 'П', holder: 'Б', switch_kcd: 'В', wires: 'п' },
};

function drawSide(r) {
  const W = 940, H = 360, mL = 50, mB = 40;
  const s = Math.min((W - 2 * mL) / r.L, (H - 2 * mB) / (r.D * 1.35));
  const X = x => mL + x * s, Z = z => H - mB - z * s;
  const st = r.hull.stations;
  let d = `M ${X(0)} ${Z(st[0].pts[0].z)} `;
  for (const q of st) d += `L ${X(q.x)} ${Z(q.pts[0].z)} `;
  d += `L ${X(r.L)} ${Z(r.D)} `;
  let out = svgOpen(W, H);
  out += `<path d="${d}" fill="none" stroke="#16161a" stroke-width="2"/>`;
  out += `<path d="M ${X(0)} ${Z(r.D)} L ${X(r.L)} ${Z(r.D)}" stroke="#16161a" stroke-width="2"/>`;
  out += `<line x1="${X(0)}" y1="${Z(st[0].pts[0].z)}" x2="${X(0)}" y2="${Z(r.D)}" stroke="#16161a" stroke-width="2"/>`;
  if (r.eq.floats) {
    out += `<line x1="${X(-0.02 * r.L)}" y1="${Z(r.eq.Ta)}" x2="${X(1.02 * r.L)}" y2="${Z(r.eq.Tf)}" stroke="#2b4fa0" stroke-width="1.6" stroke-dasharray="8 5"/>`;
    out += `<text x="${X(1.02 * r.L)}" y="${Z(r.eq.Tf) - 6}" class="lbl-dim" fill="#2b4fa0" text-anchor="end">ВЛ</text>`;
  }
  for (const sh of r.shaftLine) {
    out += `<line x1="${X(sh.x1)}" y1="${Z(sh.z1)}" x2="${X(sh.x2)}" y2="${Z(sh.z2)}" stroke="#6b6b74" stroke-width="2.5"/>`;
    out += `<circle cx="${X(sh.x1)}" cy="${Z(sh.z1)}" r="${r.DpEff / 2 * s}" fill="none" stroke="#0e6b5e" stroke-width="2"/>`;
  }
  if (r.rudder) {
    const rx = X(r.rudder.x / 1000), rw = r.rudder.chord / 1000 * s, rh = r.rudder.span / 1000 * s;
    out += `<rect x="${rx - rw / 4}" y="${Z(r.rudder.zTop / 1000)}" width="${rw}" height="${rh}" rx="3" fill="none" stroke="#b3382e" stroke-width="2"/>`;
  }
  // люк на палубе
  out += `<line x1="${X(r.hatch.x1 / 1000)}" y1="${Z(r.D) - 4}" x2="${X(r.hatch.x2 / 1000)}" y2="${Z(r.D) - 4}" stroke="#0e6b5e" stroke-width="3"/>`;
  out += `<text x="${(X(r.hatch.x1 / 1000) + X(r.hatch.x2 / 1000)) / 2}" y="${Z(r.D) - 8}" class="lbl-dim" text-anchor="middle">люк</text>`;
  // компоненты
  let n = 0;
  const dragKeys = DRAGGABLE[r.kit];
  for (const c of r.comps) {
    if (c.twin && c.y < 0) continue;
    n++;
    const cw = c.Lmm / 1000 * s, ch = c.Hmm / 1000 * s;
    const cx = X(c.x) - cw / 2, cy = Z(c.z) - ch / 2;
    const dragId = dragKeys[c.id] !== undefined ? c.id
      : (SLED[r.kit].includes(c.id) ? '__sled' : null);
    out += `<g class="${dragId ? 'comp' : ''}" data-id="${dragId || ''}" style="cursor:${dragId ? 'ew-resize' : 'default'}">` +
      `<rect x="${cx}" y="${cy}" width="${Math.max(6, cw)}" height="${Math.max(5, ch)}" rx="2" fill="#0e6b5e18" stroke="#0e6b5e" stroke-width="1.4"/>` +
      `<text x="${cx + Math.max(6, cw) / 2}" y="${cy - 4}" class="lbl-dim" text-anchor="middle">${n}</text></g>`;
    c.tag = n;
  }
  // крепления пунктиром
  for (const f of r.fitsAboard) {
    if (f.absolute) continue;
    const fw = f.dims[0] / 1000 * s, fh = f.dims[2] / 1000 * s;
    out += `<rect x="${X(f.place.x / 1000) - fw / 2}" y="${Z((f.place.z + f.dims[2]) / 1000)}" width="${fw}" height="${fh}" fill="none" stroke="#0e6b5e88" stroke-width="1" stroke-dasharray="3 3"/>`;
  }
  // балласт
  const f2 = r.fits.find(f => f.id === 'fit_ballast');
  if (f2) {
    const bw = f2.dims[0] / 1000 * s;
    out += `<g class="comp" data-id="__ballast" style="cursor:ew-resize"><rect x="${X(r.xBall) - bw / 2}" y="${Z(r.zBall) - 4}" width="${bw}" height="8" fill="#3a3a42" rx="2"/>` +
      `<text x="${X(r.xBall)}" y="${Z(r.zBall) - 8}" class="lbl-dim" text-anchor="middle">Б</text></g>`;
  }
  out += marker(X(r.xg), Z(r.zg), '#b3382e', 'ЦТ');
  if (r.eq.floats) out += marker(X(r.eq.h.xb), Z(r.eq.h.zb), '#2b4fa0', 'ЦВ');
  out += `<text x="${mL}" y="18" class="lbl-dim">Бок: компоновка (тяните мотор, салазки, батарею, балласт вдоль корпуса)</text>`;
  out += '</svg>';
  return { out, scale: s, X0: mL };
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
  for (const sgn of [1, -1]) {
    let d = '';
    r.hull.stations.forEach((st, k) => {
      d += (k ? 'L' : 'M') + ' ' + X(st.x) + ' ' + Y(sgn * st.pts[st.pts.length - 1].y) + ' ';
    });
    out += `<path d="${d}" fill="none" stroke="#16161a" stroke-width="2"/>`;
  }
  out += `<line x1="${X(0)}" y1="${Y(r.hull.stations[0].pts[r.hull.stations[0].pts.length - 1].y)}" x2="${X(0)}" y2="${Y(-r.hull.stations[0].pts[r.hull.stations[0].pts.length - 1].y)}" stroke="#16161a" stroke-width="2"/>`;
  // люк
  out += `<rect x="${X(r.hatch.x1 / 1000)}" y="${Y(r.hatch.hw / 1000)}" width="${X(r.hatch.x2 / 1000) - X(r.hatch.x1 / 1000)}" height="${2 * r.hatch.hw / 1000 * s}" fill="none" stroke="#0e6b5e" stroke-width="1.5" stroke-dasharray="6 4"/>`;
  out += `<text x="${mL}" y="18" class="lbl-dim">Полуширота: палуба, ватерлинии, люк (пунктир)</text>`;
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
    const aft = i <= 5;
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
  out += `<text x="${mL + 4}" y="20" class="lbl-dim">l(θ), мм: ${(gzmax * 1000).toFixed(1)} макс.</text>`;
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
    stepRow('Крепления, палуба, люк (' + r.fitsAboard.length + ' печатных дет.)', '', fmt(r.mFits * 1000, 0) + ' г') +
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
    stepRow('r = I<sub>x</sub>/V', '', mm(h.BMt) + ' мм') +
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
    const sp2 = r.speed, dr = DRIVE[r.kit];
    s += `<details><summary><b>5. Скорость (оценка)</b></summary>` +
      stepRow('Винт (вписан под подзор)', '', `${dr.count}×Ø${fmt(r.DpEff * 1000, 0)} мм, шаг ${fmt(r.pitchEff * 1000, 0)} мм, ${dr.rpm} об/с (${dr.motor}); покупать ближайший Ø`) +
      stepRow('Шаговый угол лопасти на 0,7R', 'φ = arctg(P/2π·0,7R)', fmt(Math.atan(r.pitchEff / (2 * Math.PI * 0.7 * r.DpEff / 2)) * 180 / Math.PI, 1) + '°') +
      stepRow('Re = V·L<sub>ВЛ</sub>/ν', `${f(sp2.V)}·${f(h.Lwl)}/10⁻⁶`, fmtE(sp2.Re, 2)) +
      stepRow('C<sub>F</sub> (ИТТК-57)', '0,075/(lg Re − 2)²', fmtE(sp2.Cf, 2)) +
      stepRow('Fr = V/√(gL)', `${f(sp2.V)}/√(9,81·${f(h.Lwl)})`, f(sp2.Fn)) +
      stepRow('C<sub>R</sub>(Fr) по типу обводов', '', fmtE(sp2.Cr, 2)) +
      stepRow('R = (C<sub>F</sub>(1+k)+C<sub>A</sub>+C<sub>R</sub>)·½ρSV²', '', fmt(sp2.R * 1000, 0) + ' мН') +
      stepRow('Упор T = K<sub>T</sub>·ρ·n²·D⁴ (равновесие T = R)', '', fmt(sp2.Tprop * 1000, 0) + ' мН') +
      stepRow('V', '', '<b>' + f(sp2.V) + ' м/с (' + f(sp2.V * 3.6, 1) + ' км/ч)</b>') +
      stepRow('Время хода t = C/I', `${dr.cap} А·ч / ${dr.amp} А`, fmt(dr.cap / dr.amp, 1) + ' ч') +
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
  r.clearance = clearanceViolations(r, assemblyParts(r, { noHull: true }));
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
  $('checks').innerHTML = checks(r).map(c => {
    const ico = { ok: '✔', warn: '⚠', bad: '✖', info: 'ℹ' }[c.lvl];
    const col = { ok: '#1d7a3e', warn: '#b07a1e', bad: '#b3382e', info: '#2b4fa0' }[c.lvl];
    return `<div style="margin:4px 0"><span style="color:${col};font-weight:700">${ico}</span> ${c.txt}</div>`;
  }).join('');
  const side = drawSide(r);
  $('side').innerHTML = side.out;
  $('plan').innerHTML = drawPlan(r);
  $('bodyplan').innerHTML = drawBody(r);
  $('gzplot').innerHTML = drawGZ(r);
  const seen = new Set();
  $('legend').innerHTML = '<table><tr><th>№</th><th>Компонент</th><th>Масса, г</th><th>x от транца, мм</th></tr>' +
    r.comps.filter(c => { if (seen.has(c.id)) return false; seen.add(c.id); return true; })
      .map(c => `<tr><td>${c.tag || ''}</td><td>${c.name}${c.twin ? ' ×2' : ''}</td><td>${fmt(c.mass * 1000 * (c.twin ? 2 : 1), 0)}</td><td>${fmt(c.x * 1000, 0)}</td></tr>`).join('') +
    `<tr><td>Б</td><td>Балласт (свинец/гайки в карман)</td><td>${fmt(r.mBall * 1000, 0)}</td><td>${fmt(r.xBall * 1000, 0)}</td></tr></table>`;
  if ($('fitlist')) {
    $('fitlist').innerHTML = '<table><tr><th>Деталь</th><th>Габарит, мм</th><th>Масса, г</th><th>Где стоит</th></tr>' +
      r.fits.map(f => `<tr><td>${f.name}</td><td>${f.dims.map(d => d.toFixed(0)).join('×')}</td>` +
        `<td>${fmt(f.mass, 1)}</td><td>${f.place ? (f.absolute ? 'по всей длине' : 'x = ' + fmt(f.place.x, 0) + ' мм') : 'на берегу (в массу не входит)'}</td></tr>`).join('') +
      `</table><p class="note">Печатных деталей ${r.fits.length}, на борту ${fmt(r.mFits * 1000, 0)} г —
       уже в нагрузке масс; у донных креплений подошвы повторяют обводы днища.
       Подробно — на странице <a href="fittings">«Крепления и оснастка»</a>.</p>`;
  }
  $('steps').innerHTML = renderSteps(r);
  attachDrag(side);
  schedule3d();
  const info = PROTOS[state.proto];
  $('protoAbout').textContent = info.about + ' Набор электроники: «' + ((partsDb().kits[r.kit] || {}).title || r.kit) + '».';
  try { localStorage.setItem('modelboat-state', JSON.stringify(state)); } catch (e) { }
}

/* перетаскивание якорей компоновки */
function attachDrag(side) {
  const svg = $('side').querySelector('svg');
  if (!svg) return;
  let target = null;
  const fxOf = ev => {
    const pt = svg.createSVGPoint();
    pt.x = ev.clientX; pt.y = ev.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    return clamp((p.x - side.X0) / side.scale / cur.L, 0.03, 0.95);
  };
  svg.addEventListener('pointerdown', ev => {
    const g = ev.target.closest('.comp');
    if (!g || !g.dataset.id) return;
    target = g.dataset.id;
    svg.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  });
  svg.addEventListener('pointermove', ev => {
    if (!target) return;
    const fxv = fxOf(ev);
    if (target === '__ballast') { state.ballastFx = fxv; if ($('ballastFx')) $('ballastFx').value = fxv; }
    else state.pos[target] = fxv;
    refresh();
  });
  svg.addEventListener('pointerup', () => { target = null; });
}

/* ---------- железная проверка невыхода из корпуса ----------
 * Каждая вершина каждой детали обязана лежать внутри внутренней
 * поверхности корпуса (|y| ≤ y_внутр(x,z), z ≤ палубы, 0 ≤ x ≤ L)
 * с допуском 1,2 мм. Исключения — детали, которым положено выходить:
 * дейдвуд (сквозь днище), винт и перо руля (за транцем), палуба с
 * крышкой (на планшире). Возвращает нарушителей с глубиной, мм. */
const CLEAR_TOL = 1.2;
const CLEAR_ALLOW = /Корпус|Дейдвуд|Гребной винт|Перо руля|Палуба|Крышка люка|Балласт:/;
function clearanceViolations(r, parts) {
  const L = r.L * 1000, D = r.D * 1000, wallMM = r.wall * 1000;
  const sts = r.hull.stations;
  const yIn = (xMM, zMM) => {
    const st = sts[Math.max(0, Math.min(sts.length - 1,
      Math.round(xMM / L * (sts.length - 1))))];
    return yAt(st, zMM / 1000) * 1000 - wallMM;
  };
  const out = [];
  for (const p of parts) {
    if (CLEAR_ALLOW.test(p.name)) continue;
    let worst = 0, where = '';
    for (const t of p.tris) for (const v of t) {
      if (v[0] < -CLEAR_TOL) { if (worst < 99) { worst = 99; where = 'за транцем'; } continue; }
      if (v[0] > L + CLEAR_TOL) { if (worst < 99) { worst = 99; where = 'за форштевнем'; } continue; }
      const inHatch = r.hatch && v[0] > r.hatch.x1 && v[0] < r.hatch.x2 &&
        Math.abs(v[1]) < r.hatch.hw;
      const zCap = inHatch ? D + 5 : D;
      if (v[2] > zCap + CLEAR_TOL) {
        if (v[2] - zCap > worst) { worst = v[2] - zCap; where = 'выше палубы'; }
        continue;
      }
      const pen = Math.abs(v[1]) - yIn(v[0], Math.max(0, Math.min(v[2], D - 0.1)));
      if (pen > worst) { worst = pen; where = 'сквозь обшивку'; }
    }
    if (worst > CLEAR_TOL) out.push({ name: p.name, depth: worst, where });
  }
  out.sort((a, b) => b.depth - a.depth);
  return out;
}

/* ---------- сборка для 3D-вида и экспорта ---------- */
function assemblyParts(r, opts) {
  const cut = opts && opts.cut;
  const parts = [];
  if (!(opts && opts.noHull)) {
    const hullHi = makeHull(state.proto, { L: r.L, B: r.B, D: r.D }, r.morph, { nst: 121, nzc: 57 });
    let hullTris = hullMesh(hullHi, r.wall);
    if (cut) hullTris = hullTris.filter(t => (t[0][1] + t[1][1] + t[2][1]) / 3 < 1.5);
    parts.push({ name: 'Корпус', color: [0.62, 0.72, 0.78], tris: hullTris });
  }
  const colorOf = c => {
    if (/^(nano|esp32c3|hm10|hc05|mx1508|tp4056|buck)/.test(c.id)) return [0.19, 0.31, 0.63];
    if (/^motor/.test(c.id)) return [0.70, 0.22, 0.18];
    if (/servo/.test(c.id)) return [0.85, 0.45, 0.15];
    if (/batt|holder/.test(c.id)) return [0.72, 0.55, 0.15];
    return [0.45, 0.45, 0.48];
  };
  for (const c of r.comps) {
    if (c.draw === false) continue; // винты и вал в 3D рисуются честнее ниже
    const cx = c.x * 1000, cy = c.y * 1000, cz = c.z * 1000;
    // деталь строится в нуле, поворачивается (наклон по линии вала) и ставится
    let tris = c.shape === 'cyl'
      ? fRotY(fRing(0, 0, -c.Lmm / 2, c.Wmm / 2, 0, c.Lmm, 20), 90)
      : fBox(0, 0, 0, c.Lmm, c.Wmm, c.Hmm);
    if (c.rotY) tris = fRotY(tris, c.rotY);
    parts.push({ name: c.name, color: colorOf(c), tris: fMove(tris, cx, cy, cz) });
  }
  for (const f of r.fitsAboard) {
    if (f.id === 'fit_deck' || f.id === 'fit_hatch') {
      if (cut) continue; // в разрезе палубу снимаем, чтобы видеть начинку
      parts.push({
        name: f.name, color: [0.55, 0.62, 0.58],
        tris: fMove(f.tris, 0, 0, f.place.z),
      });
      continue;
    }
    parts.push({
      name: f.name, color: [0.09, 0.45, 0.38],
      tris: fMove(f.tris, f.place.x, f.place.y || 0, f.place.z),
    });
  }
  // дейдвудные трубки (по линии вала) и лопастные винты за транцем
  const dr = DRIVE[r.kit];
  for (const s of r.shaftLine) {
    const dx = (s.x2 - s.x1) * 1000, dz = (s.z2 - s.z1) * 1000;
    const len = Math.hypot(dx, dz);
    const ang = Math.atan2(dx, dz) * 180 / Math.PI;
    parts.push({
      name: 'Дейдвудная трубка Ø5 с валом Ø2 (сквозь днище у транца)', color: [0.5, 0.45, 0.25],
      tris: fMove(fRotY(fRing(0, 0, 6, 2.5, 0, len - 6, 14), ang), s.x1 * 1000, s.y * 1000, s.z1 * 1000),
    });
    parts.push({
      name: `Гребной винт Ø${(r.DpEff * 1000).toFixed(0)} мм, шаг ${(r.pitchEff * 1000).toFixed(0)} мм (под подзором)`, color: [0.75, 0.6, 0.2],
      tris: fMove(propMesh(r.DpEff * 1000, r.pitchEff * 1000, 3, 0.25 * r.DpEff * 1000, 7),
        s.x1 * 1000, s.y * 1000, s.z1 * 1000),
    });
  }
  // балласт — засыпка внутри своего кармана
  const fBal = r.fits.find(f => f.id === 'fit_ballast');
  if (fBal && r.mBall > 0.001) {
    const iw = (fBal.ballW || 20) - 2, il = (fBal.ballL || 60) - 8;
    const fillH = Math.min((fBal.ballH || 10) - 1.5,
      Math.max(3, r.mBall * 1e6 / 6 / (iw * il)));
    parts.push({
      name: `Балласт: свинцовая дробь или гайки М8, ${(r.mBall * 1000).toFixed(0)} г (в кармане, залит эпоксидкой)`,
      color: [0.25, 0.25, 0.28],
      tris: fBox(fBal.place.x, 0, fBal.place.z + 2 + fillH / 2, il, iw, fillH),
    });
  }
  return parts;
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
  if (!viewer) {
    viewer = viewer3d(cv);
    window._v3d = viewer;
    if (viewer && viewer.onPick && $('pickinfo')) {
      viewer.onPick(name => {
        $('pickinfo').innerHTML = name
          ? '<b>Деталь:</b> ' + name
          : 'Кликните по детали, чтобы узнать, что это (перетаскивание — поворот).';
      });
    }
  }
  if (!viewer) return;
  const r = cur || compute();
  viewer.setParts(assemblyParts(r, { cut: $('cut3d') && $('cut3d').checked }));
}

/* ---------- экспорт ---------- */
function doExport(kind) {
  const r = cur || compute();
  const nm = 'boat-' + state.proto + '-' + state.L;
  if (kind === 'stl') {
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
      r.hull, r.comps, r.shaftLine,
      r.rudder ? { x: r.rudder.x / 1000, chord: r.rudder.chord, span: r.rudder.span, thick: r.rudder.thick } : null);
    spec.components = spec.components.concat(r.fitsAboard.map(f => ({
      id: f.id, name: f.name,
      x: +(f.absolute ? r.L * 500 : f.place.x).toFixed(1),
      y: +((f.place.y || 0)).toFixed(1),
      z: +(f.place.z + f.dims[2] / 2).toFixed(1),
      L: +f.dims[0].toFixed(1), W: +f.dims[1].toFixed(1), H: +f.dims[2].toFixed(1),
      shape: 'box',
    })));
    download(new Blob([JSON.stringify(spec, null, 1)], { type: 'application/json' }), 'boat.json');
  }
  if (kind === 'csv') download(offsetsCsv(r.hull), nm + '-ординаты.csv');
}

/* экспорт для node-тестов (в браузере module нет) */
if (typeof module !== 'undefined') {
  module.exports = { compute, assemblyParts, clearanceViolations, checks, state, DRIVE, SLED };
}

/* ---------- запуск ---------- */
if (typeof window !== 'undefined') window.addEventListener('DOMContentLoaded', () => {
  try {
    const saved = JSON.parse(localStorage.getItem('modelboat-state') || 'null');
    if (saved && saved.proto) Object.assign(state, saved, { pos: saved.pos || {} });
  } catch (e) { }
  for (const [id, key] of [
    ['L', 'L'], ['LB', 'LB'], ['DB', 'DB'], ['full', 'full'], ['transom', 'transom'],
    ['bow', 'bow'], ['wall', 'wall'], ['ballast', 'ballast'], ['ballastFx', 'ballastFx']]) {
    const el = $(id);
    if (el) { el.value = state[key]; const lab = $(id + '_v'); if (lab) lab.textContent = el.value; }
    bind(id, key, true);
  }
  $('proto').value = state.proto;
  const PROTO_BALLAST = { tug: 350, launch: 150, cargo: 300 };
  $('proto').addEventListener('change', () => {
    state.proto = $('proto').value;
    state.pos = {};
    state.ballast = PROTO_BALLAST[state.proto] || 250;
    if ($('ballast')) { $('ballast').value = state.ballast; const lb = $('ballast_v'); if (lb) lb.textContent = state.ballast; }
    refresh();
  });
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
