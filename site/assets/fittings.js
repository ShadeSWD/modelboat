/* Крепления и фундаменты: параметрические печатные детали под выбранный
 * корпус и набор — фундамент мотора, кроватка батареи, салазки плат,
 * кронштейн серво, карман балласта, опоры дейдвуда, перо руля, стапель.
 *
 * Всё строится без булевых операций из замкнутых примитивов:
 *   fBox   — параллелепипед (с поворотом вокруг X или Y);
 *   fRing  — кольцевая призма (винтовая бобышка с отверстием, труба);
 *   fPrism — экструзия произвольного многоугольника (ушная триангуляция —
 *            профили с V-вырезом и ложе стапеля по обводам вогнутые).
 * Слайсер объединяет пересекающиеся замкнутые тела сам. Размеры в мм. */
'use strict';

/* ---------- примитивы ---------- */
function fBox(cx, cy, cz, lx, ly, lz, rotYdeg, rotXdeg) {
  const p = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1])
    p.push([sx * lx / 2, sy * ly / 2, sz * lz / 2]);
  const ry = (rotYdeg || 0) * Math.PI / 180, rx = (rotXdeg || 0) * Math.PI / 180;
  for (const v of p) {
    let [x, y, z] = v;
    let x2 = x * Math.cos(ry) + z * Math.sin(ry), z2 = -x * Math.sin(ry) + z * Math.cos(ry);
    let y2 = y * Math.cos(rx) - z2 * Math.sin(rx); z2 = y * Math.sin(rx) + z2 * Math.cos(rx);
    v[0] = x2 + cx; v[1] = y2 + cy; v[2] = z2 + cz;
  }
  // индексы вершин: p[i], i = sx*4+sy*2+sz (0/1)
  const q = (a, b, c, d) => [[p[a], p[b], p[c]], [p[a], p[c], p[d]]];
  return [].concat(
    q(0, 1, 3, 2),   // x−
    q(4, 6, 7, 5),   // x+
    q(0, 4, 5, 1),   // y−
    q(2, 3, 7, 6),   // y+
    q(0, 2, 6, 4),   // z−
    q(1, 5, 7, 3),   // z+
  );
}

function fRing(cx, cy, cz, rOut, rIn, h, nSeg) {
  const n = nSeg || 24, T = [];
  const P = (r, a, z) => [cx + r * Math.cos(a), cy + r * Math.sin(a), cz + z];
  for (let i = 0; i < n; i++) {
    const a0 = i / n * 2 * Math.PI, a1 = (i + 1) / n * 2 * Math.PI;
    const oa0 = P(rOut, a0, 0), oa1 = P(rOut, a1, 0), ob0 = P(rOut, a0, h), ob1 = P(rOut, a1, h);
    const ia0 = P(rIn, a0, 0), ia1 = P(rIn, a1, 0), ib0 = P(rIn, a0, h), ib1 = P(rIn, a1, h);
    T.push([oa0, oa1, ob1], [oa0, ob1, ob0]);          // наружная стенка
    if (rIn > 0) {
      T.push([ia0, ib1, ia1], [ia0, ib0, ib1]);        // внутренняя (нормали внутрь отверстия)
      T.push([ob0, ob1, ib1], [ob0, ib1, ib0]);        // верхнее кольцо
      T.push([oa0, ia1, oa1], [oa0, ia0, ia1]);        // нижнее кольцо
    } else {
      T.push([ob0, ob1, P(0, 0, h)]);                  // сплошной цилиндр: крышки веером
      T.push([oa1, oa0, P(0, 0, 0)]);
    }
  }
  return T;
}

/* ушная триангуляция простого многоугольника (CCW, без самопересечений) */
function earClip(pts) {
  const n = pts.length, idx = [];
  for (let i = 0; i < n; i++) idx.push(i);
  const area2 = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inside = (a, b, c, p) =>
    area2(a, b, p) >= -1e-9 && area2(b, c, p) >= -1e-9 && area2(c, a, p) >= -1e-9;
  const tris = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const a = pts[idx[(i + idx.length - 1) % idx.length]], b = pts[idx[i]],
        c = pts[idx[(i + 1) % idx.length]];
      if (area2(a, b, c) <= 1e-9) continue;             // вогнутая вершина
      let ok = true;
      for (const j of idx) {
        const p = pts[j];
        if (p === a || p === b || p === c) continue;
        if (inside(a, b, c, p)) { ok = false; break; }
      }
      if (!ok) continue;
      tris.push([a, b, c]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;                                // защита от зацикливания
  }
  if (idx.length === 3) tris.push([pts[idx[0]], pts[idx[1]], pts[idx[2]]]);
  return tris;
}

/* экструзия профиля (x,y), CCW, от z0 до z1 */
function fPrism(profileRaw, z0, z1) {
  // чистка: дубликаты и коллинеарные точки ломают ушную триангуляцию,
  // а крышка обязана использовать ровно те же вершины, что и стенки
  const profile = [];
  for (const p of profileRaw) {
    const q = profile[profile.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.05) profile.push(p);
  }
  for (let i = profile.length - 1; i >= 0 && profile.length > 3; i--) {
    const a = profile[(i + profile.length - 1) % profile.length], b = profile[i],
      c = profile[(i + 1) % profile.length];
    const ar = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(ar) < 0.01) profile.splice(i, 1);
  }
  const T = [];
  const cap = earClip(profile);
  for (const t of cap) {
    T.push([[t[0][0], t[0][1], z1], [t[1][0], t[1][1], z1], [t[2][0], t[2][1], z1]]); // верх
    T.push([[t[0][0], t[0][1], z0], [t[2][0], t[2][1], z0], [t[1][0], t[1][1], z0]]); // низ
  }
  for (let i = 0; i < profile.length; i++) {
    const a = profile[i], b = profile[(i + 1) % profile.length];
    const A0 = [a[0], a[1], z0], B0 = [b[0], b[1], z0], A1 = [a[0], a[1], z1], B1 = [b[0], b[1], z1];
    T.push([A0, B0, B1], [A0, B1, A1]);
  }
  return T;
}

const fMove = (tris, dx, dy, dz) =>
  tris.map(t => t.map(p => [p[0] + dx, p[1] + dy, p[2] + dz]));

/* поворот вокруг оси Y (в плоскости XZ), градусы; ориентация сохраняется */
function fRotY(tris, deg) {
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return tris.map(t => t.map(p => [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c]));
}

function meshVolumeCm3(tris) {
  let v6 = 0;
  for (const [a, b, c] of tris)
    v6 += a[0] * (b[1] * c[2] - c[1] * b[2]) - b[0] * (a[1] * c[2] - c[1] * a[2]) + c[0] * (a[1] * b[2] - b[1] * a[2]);
  return Math.abs(v6 / 6) / 1000;
}

/* ---------- узлы ----------
 * Каждый генератор возвращает треугольники в СВОЕЙ системе (деталь лежит
 * основанием на z=0, как на столе принтера) + габариты для раскладки. */

/* стяжной «мостик» под кабельную стяжку: две стойки и перекладина */
function zipBridge(cx, cy, span, h) {
  return [].concat(
    fBox(cx - span / 2, cy, h / 2, 3, 4, h),
    fBox(cx + span / 2, cy, h / 2, 3, 4, h),
    fBox(cx, cy, h + 1.25, span + 3, 4, 2.5),
  );
}

/* V-ложемент под цилиндр Ø d, лежащий вдоль Y; длина ложемента len */
function vCradle(d, len, extraH) {
  const w = d + 10, hSeat = d * 0.36 + (extraH || 0), depth = d * 0.42;
  // профиль в (x,z): прямоугольник с V-вырезом сверху
  const prof = [
    [-w / 2, 0], [w / 2, 0], [w / 2, hSeat + depth],
    [d * 0.42, hSeat + depth], [0, hSeat], [-d * 0.42, hSeat + depth],
    [-w / 2, hSeat + depth],
  ];
  // экструзия вдоль Y: fPrism даёт тело по Z, обмен осей (x,z,y) кладёт
  // цилиндр вдоль Y; обмен осей — отражение, поэтому обход треугольников
  // разворачивается обратно (иначе нормали смотрят внутрь)
  const flat = fPrism(prof.map(p => [p[0], p[1]]), -len / 2, len / 2);
  const tris = flat.map(t => [t[0], t[2], t[1]].map(p => [p[0], p[2], p[1]]));
  return { tris, w, len, h: hSeat + depth };
}

/* карман-лоток с бортиками: базовая плита + периметр + перегородки */
function trayPocket(L, W, wallH, cross) {
  const t = 2.4, base = 2.0;
  let T = fBox(0, 0, base / 2, L, W, base);
  T = T.concat(
    fBox(0, W / 2 - t / 2, base + wallH / 2, L, t, wallH),
    fBox(0, -W / 2 + t / 2, base + wallH / 2, L, t, wallH),
    fBox(L / 2 - t / 2, 0, base + wallH / 2, t, W, wallH),
    fBox(-L / 2 + t / 2, 0, base + wallH / 2, t, W, wallH),
  );
  for (const cx of cross || [])
    T = T.concat(fBox(cx, 0, base + wallH / 2, t, W - 2 * t, wallH));
  return T;
}

/* ---------- набор узлов под состояние конструктора ----------
 * db — PARTS_DB, state/derived — из boat.js. Возвращает список деталей:
 * {id, name, tris, dims:[lx,ly,lz], volCm3, mass, place:{x,y,z}|null, note}
 * place — положение в корпусе (мм от транца/ДП/ОП), null — деталь береговая. */
function buildFittings(ctx) {
  const { kit, parts, hullStations, L, B, D, wall, ballast, ballastFx, comps, shaftAngleDeg, rudder } = ctx;
  const RHO_PLA = 1.24; // г/см³, печать монолитом
  const out = [];
  const add = (id, name, tris, place, note) => {
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, maxZ = 0;
    for (const t of tris) for (const p of t) {
      minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
      minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
      maxZ = Math.max(maxZ, p[2]);
    }
    const vol = meshVolumeCm3(tris);
    out.push({
      id, name, tris, dims: [maxX - minX, maxY - minY, maxZ], volCm3: vol,
      mass: vol * RHO_PLA, place, note,
    });
  };
  const compAt = id => comps.find(c => c.id === id);

  if (kit === 'classic') {
    const mtr = compAt('motor_130'), srv = compAt('servo_sg90'), bat = compAt('holder_2x18650');
    // фундамент мотора 130: V-ложемент под Ø21 с углом линии вала + мостик стяжки
    const d = (parts.motor_130 && parts.motor_130.W) || 21;
    const cr = vCradle(d, 22, 2);
    let T = cr.tris.map(t => t.map(p => { // наклон ложемента на угол вала (вокруг X)
      const a = (shaftAngleDeg || 0) * Math.PI / 180;
      return [p[0], p[1] * Math.cos(a) - p[2] * Math.sin(a) * 0, p[2]]; // площадка ровная, вал наклоняет сам мотор карданом
    }));
    T = T.concat(zipBridge(0, 0, d + 12, cr.h + 2));
    add('fit_motor', 'Фундамент мотора 130 (V-ложемент, стяжка)', T,
      mtr ? { x: mtr.x * 1000, y: 0, z: (mtr.z - (parts.motor_130.H || 25) / 2000) * 1000 } : null,
      'клеится эпоксидкой на днище; мотор фиксируется кабельной стяжкой через мостик');
    // кронштейн серво SG90: карман по корпусу + две бобышки под винты фланца
    T = trayPocket(32, 16, 12, []);
    T = T.concat(fRing(-13.9, 0, 0, 3, 1.0, 14), fRing(13.9, 0, 0, 3, 1.0, 14));
    add('fit_servo', 'Кронштейн серво SG90 (бобышки под штатные винты)', T,
      srv ? { x: srv.x * 1000, y: 0, z: (srv.z - 0.0145) * 1000 } : null,
      'серво вставляется в карман, фланец притягивается штатными винтами в бобышки Ø2');
    // кроватка батареи (холдер 2×18650)
    const bw = (parts.holder_2x18650 && parts.holder_2x18650.W) || 41;
    const bl = (parts.holder_2x18650 && parts.holder_2x18650.L) || 78;
    T = trayPocket(bl + 6, bw + 6, 9, []).concat(zipBridge(0, 0, bw + 14, 12), zipBridge(bl * 0.3, 0, bw + 14, 12));
    add('fit_batt', 'Кроватка батареи 2×18650 (стяжки-мостики)', T,
      bat ? { x: bat.x * 1000, y: 0, z: (bat.z - 0.017) * 1000 } : null,
      'батарея — самый тяжёлый груз: без фиксации сместится при крене и опрокинет модель');
    // салазки плат: Nano + HM-10 + MX1508 + mini-360 в четырёх карманах
    T = trayPocket(96, 40, 8, [-24, 4, 28]);
    add('fit_tray', 'Салазки плат (4 кармана: Nano, HM-10, драйвер, понижайка)', T,
      { x: (compAt('nano') ? compAt('nano').x : 0.6 * L) * 1000, y: 0, z: 18 },
      'платы сажаются в карманы на двусторонний скотч; салазки выдвигаются целиком');
    // перо руля: пластина с трубчатой бобышкой под баллер Ø2
    if (rudder) {
      const ch = rudder.chord, sp = rudder.span;
      T = fBox(0, ch / 2 - 3, sp / 2, 3, ch, sp)
        .concat(fRing(0, 0, -3, 3.2, 1.1, sp + 6, 20));
      add('fit_rudder', 'Перо руля (бобышка под баллер Ø2)', T,
        { x: rudder.x, y: 0, z: 0 },
        'баллер вклеивается в бобышку эпоксидкой; печать пером вертикально');
    }
  } else { // micro
    const bat = compAt('holder_1x18650');
    // два кармана под редукторы N20
    const nw = (parts.motor_n20 && parts.motor_n20.W) || 12;
    const nh = (parts.motor_n20 && parts.motor_n20.H) || 10;
    let T = trayPocket(28, nw + 5, nh, []).concat(zipBridge(0, 0, nw + 13, nh + 2));
    const m1 = comps.filter(c => c.id === 'motor_n20');
    add('fit_motor_l', 'Карман мотора N20, левый борт', T,
      m1[0] ? { x: m1[0].x * 1000, y: m1[0].y * 1000, z: (m1[0].z - nh / 2000) * 1000 } : null,
      'редуктор входит в карман с лёгким натягом, страхуется стяжкой');
    add('fit_motor_r', 'Карман мотора N20, правый борт', T.map(t => t.map(p => p.slice())),
      m1[1] ? { x: m1[1].x * 1000, y: m1[1].y * 1000, z: (m1[1].z - nh / 2000) * 1000 } : null,
      'зеркальная установка на правом борту');
    // кроватка батареи 1×18650
    const bw = (parts.holder_1x18650 && parts.holder_1x18650.W) || 21;
    const bl = (parts.holder_1x18650 && parts.holder_1x18650.L) || 78;
    T = trayPocket(bl + 6, bw + 6, 8, []).concat(zipBridge(0, 0, bw + 14, 11));
    add('fit_batt', 'Кроватка батареи 18650', T,
      bat ? { x: bat.x * 1000, y: 0, z: (bat.z - 0.012) * 1000 } : null,
      'фиксация стяжкой; выводы холдера — в сторону выключателя');
    // платформа плат ESP32-C3 + MX1508 + TP4056 (над V-образным днищем)
    T = trayPocket(64, 26, 7, [-10, 12]);
    add('fit_tray', 'Платформа плат (ESP32-C3, драйвер, зарядка)', T,
      { x: (compAt('esp32c3') ? compAt('esp32c3').x : 0.55 * L) * 1000, y: 0, z: 16 },
      'ставится на две поперечные опоры-«мостики» над килем');
  }

  // карман балласта (объём под заданную массу; насыпная плотность дроби/гаек ~6 г/см³)
  const need = Math.max(20, ballast || 0) / 6 * 1.3; // см³ с запасом 30 %
  const ballW = 20, ballL = Math.max(40, Math.min(0.25 * L * 1000, 90));
  const ballH = Math.max(8, Math.ceil(need * 1000 / (ballW * ballL)) + 2);
  let T = trayPocket(ballL, ballW + 4, ballH, [0]);
  add('fit_ballast', `Карман балласта (${ballast || 0} г дроби или гаек М8)`, T,
    { x: ballastFx * L * 1000, y: 0, z: 2 },
    'клеится на киль до герметизации; засыпка заливается сверху эпоксидкой или парафином — грузу нельзя гулять');
  T = fBox(0, 0, 0.8, ballL + 5, ballW + 9, 1.6)
    .concat(fBox(-ballL / 2 + 4, 0, 2.6, 4, ballW - 2, 2), fBox(ballL / 2 - 4, 0, 2.6, 4, ballW - 2, 2));
  add('fit_ballast_lid', 'Крышка кармана балласта', T,
    { x: ballastFx * L * 1000, y: 0, z: 2 + ballH },
    'кладётся на карман после засыпки, по периметру — эпоксидка');

  // опоры дейдвудной трубки (Ø5): по два V-ложемента на каждый вал
  (ctx.shaftMM || []).forEach((s, si) => {
    [['a', 0.45], ['b', 0.8]].forEach(([tag, tf]) => {
      const dv = vCradle(5, 12, 4);
      add('fit_dw' + (si + 1) + tag,
        `Опора дейдвудной трубки ${si + 1}-го вала (${tag === 'a' ? 'кормовая' : 'носовая'})`,
        dv.tris.map(t => t.map(p => p.slice())),
        {
          x: s.x1 + (s.x2 - s.x1) * tf, y: s.y,
          z: Math.max(1, s.z1 + (s.z2 - s.z1) * tf - dv.h),
        },
        'трубка ложится в V-вырез и проливается эпоксидкой вместе с опорой');
    });
  });

  // стапель: два ложемента по реальным обводам (станции 0.3L и 0.65L)
  for (const [tag, fx] of [['fit_stand1', 0.30], ['fit_stand2', 0.65]]) {
    const st = hullStations[Math.round(fx * (hullStations.length - 1))];
    const cw = B * 1000 + 24, ch = D * 1000 * 0.55 + 14;
    const prof = [[-cw / 2, 0], [cw / 2, 0], [cw / 2, ch]];
    // верхняя кромка повторяет контур корпуса (с зазором 0.8 мм), справа налево
    const zTop = D * 0.55;
    for (let k = st.pts.length - 1; k >= 0; k--) {
      const p = st.pts[k];
      if (p.z > zTop) continue;
      prof.push([p.y * 1000 + 0.8, ch - (zTop - p.z) * 1000 + 0]);
    }
    for (let k = 0; k < st.pts.length; k++) {
      const p = st.pts[k];
      if (p.z > zTop) continue;
      prof.push([-p.y * 1000 - 0.8, ch - (zTop - p.z) * 1000 + 0]);
    }
    prof.push([-cw / 2, ch]);
    add(tag, tag === 'fit_stand1' ? 'Стапель, носовой ложемент (по обводам)' : 'Стапель, кормовой ложемент',
      fPrism(prof, 0, 6), null,
      'подставка для стола и испытаний: кромка повторяет теоретический шпангоут; склеить с рейкой-основанием');
  }
  return out;
}

/* раскладка деталей на «столе» и единый STL */
function fittingsMesh(fittings) {
  let x = 0;
  const all = [];
  for (const f of fittings) {
    // деталь центрирована — сдвигаем в ряд с зазором 8 мм
    let minX = 1e9, minZ = 1e9;
    for (const t of f.tris) for (const p of t) { minX = Math.min(minX, p[0]); minZ = Math.min(minZ, p[2]); }
    all.push(...fMove(f.tris, x - minX, 0, -minZ));
    x += f.dims[0] + 8;
  }
  return all;
}

if (typeof module !== 'undefined') {
  module.exports = {
    fBox, fRing, fPrism, fMove, fRotY, earClip, buildFittings, fittingsMesh,
    meshVolumeCm3, vCradle, trayPocket,
  };
}
