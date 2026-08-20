/* Крепления и оснастка: параметрические печатные детали под выбранный
 * корпус и набор. Каждое донное крепление стоит на «подошве», нижняя
 * кромка которой повторяет внутреннюю поверхность днища на своей станции —
 * деталь прилегает к обводам, а не висит в воздухе. Ушки с отверстиями
 * Ø2,5 — под самонарезы; палуба с комингсом и крышкой люка — тоже печать.
 *
 * Всё строится без булевых операций из замкнутых примитивов:
 *   fBox   — параллелепипед (с поворотом вокруг X или Y);
 *   fRing  — кольцевая призма (бобышка с отверстием, труба, ступица);
 *   fPrism — экструзия многоугольника (ушная триангуляция: профили с
 *            V-вырезом, подошвы по обводам, NACA-профиль руля).
 * Составная деталь — несколько пересекающихся тел; слайсер объединяет их
 * сам. Размеры в мм. */
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
  const q = (a, b, c, d) => [[p[a], p[b], p[c]], [p[a], p[c], p[d]]];
  return [].concat(
    q(0, 1, 3, 2), q(4, 6, 7, 5), q(0, 4, 5, 1),
    q(2, 3, 7, 6), q(0, 2, 6, 4), q(1, 5, 7, 3),
  );
}

function fRing(cx, cy, cz, rOut, rIn, h, nSeg) {
  const n = nSeg || 24, T = [];
  const P = (r, a, z) => [cx + r * Math.cos(a), cy + r * Math.sin(a), cz + z];
  for (let i = 0; i < n; i++) {
    const a0 = i / n * 2 * Math.PI, a1 = (i + 1) / n * 2 * Math.PI;
    const oa0 = P(rOut, a0, 0), oa1 = P(rOut, a1, 0), ob0 = P(rOut, a0, h), ob1 = P(rOut, a1, h);
    const ia0 = P(rIn, a0, 0), ia1 = P(rIn, a1, 0), ib0 = P(rIn, a0, h), ib1 = P(rIn, a1, h);
    T.push([oa0, oa1, ob1], [oa0, ob1, ob0]);
    if (rIn > 0) {
      T.push([ia0, ib1, ia1], [ia0, ib0, ib1]);
      T.push([ob0, ob1, ib1], [ob0, ib1, ib0]);
      T.push([oa0, ia1, oa1], [oa0, ia0, ia1]);
    } else {
      T.push([ob0, ob1, P(0, 0, h)]);
      T.push([oa1, oa0, P(0, 0, 0)]);
    }
  }
  return T;
}

/* ушная триангуляция простого многоугольника (CCW) */
function earClip(pts) {
  const n = pts.length, idx = [];
  for (let i = 0; i < n; i++) idx.push(i);
  const area2 = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inside = (a, b, c, p) =>
    area2(a, b, p) >= -1e-9 && area2(b, c, p) >= -1e-9 && area2(c, a, p) >= -1e-9;
  const tris = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 20000) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const a = pts[idx[(i + idx.length - 1) % idx.length]], b = pts[idx[i]],
        c = pts[idx[(i + 1) % idx.length]];
      if (area2(a, b, c) <= 1e-9) continue;
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
    if (!clipped) break;
  }
  if (idx.length === 3) tris.push([pts[idx[0]], pts[idx[1]], pts[idx[2]]]);
  return tris;
}

/* экструзия профиля (x,y) CCW от z0 до z1; дубли и коллинеарные точки
 * вычищаются, крышки и стенки используют одни и те же вершины */
function fPrism(profileRaw, z0, z1) {
  const profile = [];
  for (const p of profileRaw) {
    const q = profile[profile.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.05) profile.push(p);
  }
  while (profile.length > 3 &&
    Math.hypot(profile[0][0] - profile[profile.length - 1][0],
      profile[0][1] - profile[profile.length - 1][1]) < 0.05) profile.pop();
  for (let i = profile.length - 1; i >= 0 && profile.length > 3; i--) {
    const a = profile[(i + profile.length - 1) % profile.length], b = profile[i],
      c = profile[(i + 1) % profile.length];
    const ar = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(ar) < 0.01) profile.splice(i, 1);
  }
  const T = [];
  for (const t of earClip(profile)) {
    T.push([[t[0][0], t[0][1], z1], [t[1][0], t[1][1], z1], [t[2][0], t[2][1], z1]]);
    T.push([[t[0][0], t[0][1], z0], [t[2][0], t[2][1], z0], [t[1][0], t[1][1], z0]]);
  }
  for (let i = 0; i < profile.length; i++) {
    const a = profile[i], b = profile[(i + 1) % profile.length];
    T.push([[a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1]],
      [[a[0], a[1], z0], [b[0], b[1], z1], [a[0], a[1], z1]]);
  }
  return T;
}

/* экструзия вдоль Y: профиль в (y-поперёк? нет: профиль (a,b) → (a, y, b)).
 * Обмен осей — отражение, обход разворачивается. */
function fPrismY(profile, y0, y1) {
  return fPrism(profile, y0, y1).map(t => [t[0], t[2], t[1]].map(p => [p[0], p[2], p[1]]));
}
/* экструзия вдоль X: профиль (a,b) → (x, a, b); перестановка осей
 * циклическая (поворот, не отражение) — обход НЕ разворачивается */
function fPrismX(profile, x0, x1) {
  return fPrism(profile, x0, x1).map(t => t.map(p => [p[2], p[0], p[1]]));
}

const fMove = (tris, dx, dy, dz) =>
  tris.map(t => t.map(p => [p[0] + dx, p[1] + dy, p[2] + dz]));

/* поворот вокруг оси Y (в плоскости XZ), градусы */
function fRotY(tris, deg) {
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return tris.map(t => t.map(p => [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c]));
}
/* поворот вокруг оси X */
function fRotX(tris, deg) {
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return tris.map(t => t.map(p => [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c]));
}

function meshVolumeCm3(tris) {
  let v6 = 0;
  for (const [a, b, c] of tris)
    v6 += a[0] * (b[1] * c[2] - c[1] * b[2]) - b[0] * (a[1] * c[2] - c[1] * a[2]) + c[0] * (a[1] * b[2] - b[1] * a[2]);
  return Math.abs(v6 / 6) / 1000;
}

/* ---------- служебные узлы ---------- */

/* стяжной «мостик» под кабельную стяжку */
function zipBridge(cx, cy, span, h) {
  return [].concat(
    fBox(cx - span / 2, cy, h / 2, 3, 4, h),
    fBox(cx + span / 2, cy, h / 2, 3, 4, h),
    fBox(cx, cy, h + 1.0, span + 3, 4, 2.5),
  );
}

/* «ушко» под самонарез Ø2,5: кольцо + лапка от кромки (не закрывает отверстие) */
function lug(edgeX, edgeY, lugX, lugY, h) {
  const dx = lugX - edgeX, dy = lugY - edgeY;
  const len = Math.hypot(dx, dy) || 1;
  const armLen = Math.max(1, len - 2.2);
  const ax = edgeX + dx / len * armLen / 2, ay = edgeY + dy / len * armLen / 2;
  const arm = Math.abs(dx) > Math.abs(dy)
    ? fBox(ax, ay, h / 2, armLen, 6, h)
    : fBox(ax, ay, h / 2, 6, armLen, h);
  return arm.concat(fRing(lugX, lugY, 0, 4, 1.25, h, 20));
}

/* карман-лоток: плита + периметр + перегородки (стенки утоплены в плиту) */
function trayPocket(L, W, wallH, cross) {
  const t = 2.4, base = 2.0;
  let T = fBox(0, 0, base / 2, L, W, base);
  T = T.concat(
    fBox(0, W / 2 - t / 2 - 0.15, base - 0.3 + wallH / 2 + 0.3, L - 0.3, t, wallH + 0.6),
    fBox(0, -W / 2 + t / 2 + 0.15, base - 0.3 + wallH / 2 + 0.3, L - 0.3, t, wallH + 0.6),
    fBox(L / 2 - t / 2 - 0.15, 0, base - 0.3 + wallH / 2 + 0.3, t, W - 0.3, wallH + 0.6),
    fBox(-L / 2 + t / 2 + 0.15, 0, base - 0.3 + wallH / 2 + 0.3, t, W - 0.3, wallH + 0.6),
  );
  for (const cx of cross || [])
    T = T.concat(fBox(cx, 0, base - 0.3 + wallH / 2 + 0.3, t, W - 2 * t - 0.3, wallH + 0.6));
  return T;
}

/* V-ложемент под цилиндр Ø d вдоль Y; axisZ — высота оси цилиндра в вырезе */
function vCradle(d, len, extraH) {
  const w = d + 10, hSeat = d * 0.36 + (extraH || 0), depth = d * 0.42;
  const prof = [
    [-w / 2, 0], [w / 2, 0], [w / 2, hSeat + depth],
    [d * 0.42, hSeat + depth], [0, hSeat], [-d * 0.42, hSeat + depth],
    [-w / 2, hSeat + depth],
  ];
  return {
    tris: fPrismY(prof, -len / 2, len / 2),
    w, len, h: hSeat + depth, axisZ: hSeat + 0.707 * d,
  };
}

/* подошва по обводам: не сплошной массив, а два-три поперечных ребра
 * («шпангоутика») толщиной 3 мм; верх ребра — площадка на высоте zTop,
 * низ повторяет внутреннюю поверхность днища (yIn(z) — полуширина, мм) */
function pedestal(yInOf, zTop, halfW, len) {
  const NB = 15, bottom = [];
  for (let i = 0; i <= NB; i++) {
    const y = -halfW + i / NB * 2 * halfW;
    let z = 0;
    for (let zz = 0; zz <= zTop; zz += 0.5) {
      if (yInOf(zz) >= Math.abs(y) + 0.3) { z = zz; break; }
      z = zTop;
    }
    bottom.push([y, Math.min(z, zTop - 0.5)]);
  }
  const prof = bottom.concat([[halfW, zTop], [-halfW, zTop]]);
  const xs = len > 60 ? [-len / 2 + 4, 0, len / 2 - 4] : [-len / 2 + 3, len / 2 - 3];
  let T = [];
  for (const x of xs) T = T.concat(fPrismX(prof, x - 1.5, x + 1.5));
  // продольная связь рёбер по ДП (стрингер)
  T = T.concat(fPrismX([[-3, Math.max(0, bottom[Math.floor(NB / 2)][1] - 0.3)],
    [3, Math.max(0, bottom[Math.floor(NB / 2)][1] - 0.3)], [3, zTop], [-3, zTop]],
    -len / 2 + 2, len / 2 - 2));
  return T;
}

/* профиль NACA 00tt: замкнутый контур хордой вдоль +X от 0 до c */
function nacaLoop(c, tPct, n) {
  const N = n || 16, pts = [];
  const yt = xr => 5 * tPct * c * (0.2969 * Math.sqrt(xr) - 0.126 * xr -
    0.3516 * xr * xr + 0.2843 * xr ** 3 - 0.1036 * xr ** 4);
  for (let i = 0; i <= N; i++) { // верхняя ветвь от носика к хвостику
    const xr = i / N;
    pts.push([xr * c, yt(xr)]);
  }
  for (let i = N - 1; i > 0; i--) { // нижняя обратно
    const xr = i / N;
    pts.push([xr * c, -yt(xr)]);
  }
  return pts.reverse(); // CCW
}

/* гребной винт с настоящими лопастями: шаговый угол φ(r) = arctg(P/2πr),
 * хорда — эллиптическое распределение, лопасть — лофт тонких сечений */
function propMesh(D, P, nBlades, hubD, hubL) {
  const R = D / 2, r0 = (hubD || 0.25 * D) / 2 * 0.85;
  const NR = 7, NC = 8;
  let T = fRing(0, 0, -(hubL || 8) / 2, (hubD || 0.25 * D) / 2, 1.05, hubL || 8, 20)
    .map(t => t.map(p => [p[2], p[1], p[0]]))          // ось ступицы вдоль X
    .map(t => [t[0], t[2], t[1]]);                     // обмен осей — разворот обхода
  for (let b = 0; b < (nBlades || 3); b++) {
    const th0 = b / (nBlades || 3) * 2 * Math.PI;
    const rings = [];
    for (let i = 0; i <= NR; i++) {
      const r = r0 + i / NR * (R - r0);
      const phi = Math.atan(P / (2 * Math.PI * r));      // шаговый угол
      const cr = 0.42 * D * Math.sqrt(Math.max(0.03, 1 - Math.pow((r / R - 0.55) / 0.5, 2)));
      const th = 1.4 - 0.9 * (r - r0) / (R - r0);        // толщина к краю тоньше
      const ring = [];
      for (let k = 0; k < NC * 2; k++) {                 // петля сечения (перед и зад)
        const s = k < NC ? k / (NC - 1) : (2 * NC - 1 - k) / (NC - 1);
        const side = k < NC ? 1 : -1;
        const chordPos = (s - 0.45) * cr;                // вдоль хорды от оси
        const dx = chordPos * Math.sin(phi) + side * th / 2 * Math.cos(phi);
        const dt = chordPos * Math.cos(phi) - side * th / 2 * Math.sin(phi);
        const ang = th0 + dt / r;
        ring.push([dx, r * Math.sin(ang), r * Math.cos(ang)]);
      }
      rings.push(ring);
    }
    for (let i = 0; i < NR; i++)                        // стенки между кольцами
      for (let k = 0; k < NC * 2; k++) {
        const k2 = (k + 1) % (NC * 2);
        T.push([rings[i][k], rings[i][k2], rings[i + 1][k2]],
          [rings[i][k], rings[i + 1][k2], rings[i + 1][k]]);
      }
    for (let k = 1; k < NC * 2 - 1; k++) {              // крышки корня и кончика
      T.push([rings[0][0], rings[0][k + 1], rings[0][k]]);
      T.push([rings[NR][0], rings[NR][k], rings[NR][k + 1]]);
    }
  }
  return T;
}

/* палуба: кольцо по кромке борта с вырезом люка, комингс, крышка с ушками.
 * deckPts — [{x, y}] кромка палубы правого борта от кормы к носу, мм. */
function deckParts(deckPts, hatch, t) {
  // наружная петля: корма-ДП → правый борт → нос-ДП → левый борт
  const loop = [[deckPts[0].x, 0]];
  for (const p of deckPts) loop.push([p.x, p.y]);
  loop.push([deckPts[deckPts.length - 1].x, 0]);
  for (let i = deckPts.length - 1; i >= 0; i--) loop.push([deckPts[i].x, -deckPts[i].y]);
  // внутренняя петля — прямоугольник люка с тем же числом точек, обход тот же
  const N = loop.length;
  const rect = tPar => { // периметр прямоугольника по параметру 0..1 от кормовой середины
    const { x1, x2, hw } = hatch;
    const per = 2 * (x2 - x1) + 4 * hw;
    let d = tPar * per;
    if (d < hw) return [x1, d];
    d -= hw;
    if (d < x2 - x1) return [x1 + d, hw];
    d -= x2 - x1;
    if (d < 2 * hw) return [x2, hw - d];
    d -= 2 * hw;
    if (d < x2 - x1) return [x2 - d, -hw];
    d -= x2 - x1;
    return [x1, -hw + d];
  };
  const inner = [];
  for (let i = 0; i < N; i++) inner.push(rect(i / N));
  // кольцевое тело палубы: верхняя и нижняя крышки-кольца + стенки
  const T = [];
  const q = (A, B, C, D2, flip) => {
    if (flip) T.push([A, C, B], [A, D2, C]); else T.push([A, B, C], [A, C, D2]);
  };
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    const O0 = [loop[i][0], loop[i][1], t], O1 = [loop[j][0], loop[j][1], t];
    const I0 = [inner[i][0], inner[i][1], t], I1 = [inner[j][0], inner[j][1], t];
    const o0 = [loop[i][0], loop[i][1], 0], o1 = [loop[j][0], loop[j][1], 0];
    const i0 = [inner[i][0], inner[i][1], 0], i1 = [inner[j][0], inner[j][1], 0];
    q(O0, O1, I1, I0, false);   // верх
    q(o0, o1, i1, i0, true);    // низ
    q(o0, o1, O1, O0, false);   // наружная кромка — вниз? проверяется тестом
    q(i0, i1, I1, I0, true);    // стенка выреза
  }
  // комингс: рамка вокруг люка высотой 7 на палубе
  const { x1, x2, hw } = hatch;
  const cw = 2.4, ch = 7;
  const coaming = [].concat(
    fBox((x1 + x2) / 2, hw + cw / 2 - 0.6, t - 0.3 + ch / 2, x2 - x1 + 2 * cw, cw, ch + 0.6),
    fBox((x1 + x2) / 2, -hw - cw / 2 + 0.6, t - 0.3 + ch / 2, x2 - x1 + 2 * cw, cw, ch + 0.6),
    fBox(x1 - cw / 2 + 0.6, 0, t - 0.3 + ch / 2, cw, 2 * hw + 0.6, ch + 0.6),
    fBox(x2 + cw / 2 - 0.6, 0, t - 0.3 + ch / 2, cw, 2 * hw + 0.6, ch + 0.6),
  );
  // бобышки под винты крышки — по углам комингса
  const bosses = [];
  const bx = [x1 + 5, x2 - 5], by = [hw - 4, -(hw - 4)];
  for (const X of bx) for (const Y of by)
    bosses.push(...fRing(X, Y, t - 0.3, 3.6, 1.0, ch + 0.3, 18));
  // ориентация кольца палубы проверяется по знаку объёма
  let vol6 = 0;
  for (const [A2, B2, C2] of T)
    vol6 += A2[0] * (B2[1] * C2[2] - C2[1] * B2[2]) - B2[0] * (A2[1] * C2[2] - C2[1] * A2[2]) + C2[0] * (A2[1] * B2[2] - B2[1] * A2[2]);
  const ring = vol6 < 0 ? T.map(t2 => [t2[0], t2[2], t2[1]]) : T;
  const deck = ring.concat(coaming, bosses);
  // крышка люка: плита 2 мм + юбка-рамка внутрь комингса + 4 ушка
  let lid = fBox((x1 + x2) / 2, 0, t / 2, x2 - x1 + 2 * cw + 8, 2 * hw + 2 * cw + 8, t);
  const jw = 2;
  lid = lid.concat(
    fBox((x1 + x2) / 2, hw - 1 - jw / 2, -1.8, x2 - x1 - 4, jw, 4),
    fBox((x1 + x2) / 2, -hw + 1 + jw / 2, -1.8, x2 - x1 - 4, jw, 4),
    fBox(x1 + 2.5, 0, -1.8, jw, 2 * hw - 4, 4),
    fBox(x2 - 2.5, 0, -1.8, jw, 2 * hw - 4, 4),
  );
  for (const X of bx) for (const Y of by)
    lid.push(...fRing(X, Y, 0, 3.6, 1.4, t, 18));
  return { deck, lid, bossXY: { bx, by } };
}

/* ---------- набор узлов под состояние конструктора ----------
 * ctx: {kit, parts, hullStations, L, B, D, wall (м), ballast, ballastFx,
 *   anchors: {motorX, servoX, sledX, battX, ...} (мм), shaftMM, rudder (мм),
 *   sledSlots: [{id,L,W,H}], deckPts (мм), hatch {x1,x2,hw}}
 * Каждая деталь: {id, name, tris, dims, volCm3, mass, place{x,y,z}|null,
 *   seat?, axisZ?, note}. place.z — низ детали в корпусе (мм от ОП). */
function buildFittings(ctx) {
  const { kit, parts, hullStations, L, B, D, wall } = ctx;
  const wallMM = wall * 1000;
  const RHO_PLA = 1.24;
  const out = [];
  const add = (id, name, tris, place, note, extra) => {
    let mnX = 1e9, mxX = -1e9, mnY = 1e9, mxY = -1e9, mnZ = 1e9, mxZ = -1e9;
    for (const t of tris) for (const p of t) {
      mnX = Math.min(mnX, p[0]); mxX = Math.max(mxX, p[0]);
      mnY = Math.min(mnY, p[1]); mxY = Math.max(mxY, p[1]);
      mnZ = Math.min(mnZ, p[2]); mxZ = Math.max(mxZ, p[2]);
    }
    const vol = meshVolumeCm3(tris);
    out.push(Object.assign({
      id, name, tris, dims: [mxX - mnX, mxY - mnY, mxZ - mnZ], volCm3: vol,
      mass: vol * RHO_PLA, place, note,
    }, extra || {}));
  };
  const stAt = xMM => hullStations[Math.max(0, Math.min(hullStations.length - 1,
    Math.round(xMM / (L * 1000) * (hullStations.length - 1))))];
  // внутренняя полуширина (мм) на станции x на высоте z (мм от ОП)
  const yInAt = (xMM, zMM) => Math.max(0, yAt(stAt(xMM), zMM / 1000) * 1000 - wallMM);
  // площадка: наименьшая высота, где полуширина halfW помещается ПО ВСЕЙ
  // ДЛИНЕ детали (корпус сужается к оконечностям — центра станции мало)
  const platformZ = (xMM, halfW, lenMM) => {
    const half = (lenMM || 0) / 2;
    let worst = 1;
    for (let xo = -half; xo <= half + 0.1; xo += Math.max(3, half / 8 || 3)) {
      let zHere = D * 1000 * 0.75;
      for (let z = 1; z < D * 1000; z += 0.5)
        if (yInAt(xMM + xo, z) >= halfW + 1.8) { zHere = z + 0.5; break; }
      worst = Math.max(worst, zHere);
    }
    return worst;
  };
  // подошва: рёбра, каждое по обводам своей станции; профиль считается по
  // ХУДШЕЙ из двух граней ребра (ребро толщиной 3 мм, корпус сужается)
  const soleFor = (xMM, halfW, len, zTop) => {
    const xs = len > 110 ? [-len / 2 + 4, 0, len / 2 - 4] : [-len / 2 + 3, len / 2 - 3];
    let T = [], maxBot = 0;
    for (const xo of xs) {
      const yInR = zz => Math.min(yInAt(xMM + xo - 1.1, zz), yInAt(xMM + xo + 1.1, zz));
      const NB = 15, bottom = [];
      for (let i = 0; i <= NB; i++) {
        const y = -halfW + i / NB * 2 * halfW;
        let z = zTop - 0.5;
        for (let zz = 0; zz <= zTop; zz += 0.5)
          if (yInR(zz) >= Math.abs(y) + 0.3) { z = Math.min(zz, zTop - 0.5); break; }
        bottom.push([y, z]);
      }
      maxBot = Math.max(maxBot, bottom[Math.floor(NB / 2)][1]);
      const prof = bottom.concat([[halfW, zTop], [-halfW, zTop]]);
      T = T.concat(fPrismX(prof, xo - 1.0, xo + 1.0));
    }
    // продольный стрингер по ДП: нижняя кромка — по худшему (самому
    // высокому) дну вдоль всей длины, дно меняется от станции к станции
    let strBot = maxBot;
    for (let xo = -len / 2 + 2; xo <= len / 2 - 2; xo += 4) {
      for (let zz = 0; zz <= zTop; zz += 0.5)
        if (Math.min(yInAt(xMM + xo - 2, zz), yInAt(xMM + xo + 2, zz)) >= 3.4) {
          strBot = Math.max(strBot, zz); break;
        }
    }
    T = T.concat(fPrismX([[-2.2, Math.min(strBot, zTop - 0.5)], [2.2, Math.min(strBot, zTop - 0.5)],
      [2.2, zTop], [-2.2, zTop]], -len / 2 + 2, len / 2 - 2));
    return T;
  };
  // низ подошвы — примерно линия киля станции + стенка
  const keelZ = xMM => stAt(xMM).pts[0].z * 1000 + wallMM;

  /* донное крепление: узел на подошве; place.z = 0 у подошвы (детали
   * строятся от нуля своей площадки, подошва уходит вниз до обводов);
   * zTopOverride задаёт высоту площадки принудительно (мотор на линии вала) */
  const grounded = (id, name, nodeTris, xMM, yMM, halfW, len, note, extra, zTopOverride) => {
    const zTop = Math.max(zTopOverride || 0, platformZ(xMM, halfW + Math.abs(yMM), len));
    const sole = soleFor(xMM, Math.abs(yMM) + halfW, len, zTop);
    // подошва строится в координатах корпуса по y — сместим в локальные
    const tris = nodeTris.concat(fMove(sole, 0, -yMM, -zTop));
    add(id, name, tris, { x: xMM, y: yMM, z: zTop }, note, extra);
    return zTop;
  };

  if (kit === 'classic') {
    const d = (parts.motor_130 && parts.motor_130.W) || 21;
    const cr = vCradle(d, 22, 2);
    // ложемент наклонён на угол линии вала: мотор стыкуется с валом напрямую
    const tilt = ctx.shaftTiltDeg || 0;
    let T = cr.tris.concat(zipBridge(0, 0, d + 12, cr.h + 2));
    T = fRotY(T, tilt).map(t => t.map(p => [p[0], p[1], Math.max(p[2], -1)]));
    T = T.concat(
      lug(-(d + 10) / 2, 0, -(d + 10) / 2 - 5, 0, 3),
      lug((d + 10) / 2, 0, (d + 10) / 2 + 5, 0, 3));
    grounded('fit_motor', `Фундамент мотора 130 (наклон ${tilt.toFixed(0)}° по линии вала, стяжка, 2 ушка)`,
      T, ctx.anchors.motorX, 0, (d + 10) / 2 + 9, 26,
      'площадка наклонена по линии вала — ось мотора смотрит точно в дейдвуд, муфта работает без излома',
      { axisZ: cr.axisZ }, ctx.motorZtop);
    // кронштейн серво
    T = trayPocket(32, 16, 12, []).concat(
      fRing(-13.9, 0, 0.5, 3, 1.0, 13.5, 18), fRing(13.9, 0, 0.5, 3, 1.0, 13.5, 18));
    grounded('fit_servo', 'Кронштейн серво SG90 (бобышки под штатные винты)',
      T, ctx.anchors.servoX, 0, 18, 38,
      'серво в кармане, фланец винтами в бобышки', { seat: 2 });
    // кроватка батареи
    const bw = (parts.holder_2x18650 && parts.holder_2x18650.W) || 41;
    const bl = (parts.holder_2x18650 && parts.holder_2x18650.L) || 78;
    T = trayPocket(bl + 6, bw + 6, 9, []).concat(
      zipBridge(-bl * 0.25, 0, bw + 14, 12), zipBridge(bl * 0.25, 0, bw + 14, 12),
      lug(-(bl + 6) / 2, 0, -(bl + 6) / 2 - 5, 0, 3),
      lug((bl + 6) / 2, 0, (bl + 6) / 2 + 5, 0, 3));
    grounded('fit_batt', 'Кроватка батареи 2×18650 (стяжки, 2 ушка)',
      T, ctx.anchors.battX, 0, (bw + 6) / 2 + 2, bl + 24,
      'батарея — самый тяжёлый груз: кроватка на подошве + две стяжки', { seat: 2 });
  } else {
    const nw = (parts.motor_n20 && parts.motor_n20.W) || 12;
    const nh = (parts.motor_n20 && parts.motor_n20.H) || 10;
    const yTw = ctx.anchors.twinY;
    const tilt = ctx.shaftTiltDeg || 0;
    let T = trayPocket(28, nw + 5, nh, []).concat(zipBridge(0, 0, nw + 13, nh + 2));
    T = fRotY(T, tilt).map(t => t.map(p => [p[0], p[1], Math.max(p[2], -1)]));
    grounded('fit_motor_l', `Карман мотора N20, левый борт (наклон ${tilt.toFixed(0)}°)`, T,
      ctx.anchors.motorX, yTw, (nw + 5) / 2 + 2, 32,
      'карман наклонён по линии вала: редуктор смотрит точно в дейдвуд', { seat: 2 }, ctx.motorZtop);
    grounded('fit_motor_r', `Карман мотора N20, правый борт (наклон ${tilt.toFixed(0)}°)`,
      T.map(t => t.map(p => p.slice())),
      ctx.anchors.motorX, -yTw, (nw + 5) / 2 + 2, 32,
      'зеркально на правом борту', { seat: 2 }, ctx.motorZtop);
    const bw = (parts.holder_1x18650 && parts.holder_1x18650.W) || 21;
    const bl = (parts.holder_1x18650 && parts.holder_1x18650.L) || 78;
    T = trayPocket(bl + 6, bw + 6, 8, []).concat(
      zipBridge(0, 0, bw + 14, 11),
      lug(-(bl + 6) / 2, 0, -(bl + 6) / 2 - 5, 0, 3),
      lug((bl + 6) / 2, 0, (bl + 6) / 2 + 5, 0, 3));
    grounded('fit_batt', 'Кроватка батареи 18650 (стяжка, 2 ушка)', T,
      ctx.anchors.battX, 0, (bw + 6) / 2 + 2, bl + 8,
      'фиксация стяжкой, выводы к выключателю', { seat: 2 });
  }

  // салазки с платами + направляющие на подошвах
  const sr = sledAndRails(ctx.sledSlots, ctx.sledW);
  add('fit_sled', 'Салазки плат (карманы: ' +
    ctx.sledSlots.map(s => s.short || s.id).join(', ') + ')', sr.sled, {
    x: ctx.anchors.sledX, y: 0,
    z: platformZ(ctx.anchors.sledX, sr.sledW / 2 + 8, sr.sledLen + 8) + sr.railSeat + 2,
  }, 'платы в карманах на двустороннем скотче; салазки выдвигаются из направляющих',
    { seat: 2, offsets: sr.offsets, sledLen: sr.sledLen });
  {
    const zr = platformZ(ctx.anchors.sledX, sr.sledW / 2 + 8, sr.sledLen + 8);
    const railLen = sr.sledLen + 8;
    const soleL = soleFor(ctx.anchors.sledX, sr.sledW / 2 + 8, railLen, zr);
    add('fit_rail_l', 'Направляющая салазок, левая (на подошве)',
      sr.railL.concat(fMove(soleL, 0, 0, -zr)),
      { x: ctx.anchors.sledX, y: 0, z: zr },
      'клеится к днищу; торец в нос закрыт — салазки упираются');
    add('fit_rail_r', 'Направляющая салазок, правая (на подошве)',
      sr.railR.concat(fMove(soleL.map(t => t.map(p => [p[0], -p[1], p[2]]))
        .map(t => [t[0], t[2], t[1]]), 0, 0, -zr)),
      { x: ctx.anchors.sledX, y: 0, z: zr },
      'зеркальная пара');
  }

  // перо руля с профилем NACA 0012 и трубкой баллера
  if (ctx.rudder) {
    const { chord, span } = ctx.rudder;
    let T = fPrism(nacaLoop(chord, 0.12, 14), 0, span);
    T = T.concat(fRing(0.25 * chord, 0, -3, 3.2, 1.1, span + 6, 20));
    add('fit_rudder', `Перо руля NACA 0012 (хорда ${chord} мм)`, T,
      { x: ctx.rudder.x, y: 0, z: ctx.rudder.zTop - span },
      'баллер Ø2 вклеивается в трубку на четверти хорды; печать пером вертикально');
  }

  // гребной винт: печатная запасная копия расчётной геометрии
  if (ctx.prop) {
    const T = propMesh(ctx.prop.D, ctx.prop.P, 3, 0.25 * ctx.prop.D, 8);
    add('fit_prop', `Гребной винт Ø${ctx.prop.D} мм, шаг ${ctx.prop.P} мм (запасной, печатный)`,
      fRotY(T, 90).map(t => t.map(p => [p[0], p[1], p[2] + ctx.prop.D / 2])), null,
      'копия штатного винта: 3 лопасти, шаговый угол arctg(P/2πr); печатать лёжа с поддержками, покупной надёжнее');
  }

  // карман балласта на подошве + крышка; высота ограничена палубой —
  // если засыпка не помещается, карман делается максимальным (конструктор
  // отдельно предупредит про запас плавучести/остойчивость)
  const need = Math.max(20, ctx.ballast || 0) / 6 * 1.3;
  const ballW = 20, ballL = Math.max(40, Math.min(0.25 * L * 1000, 90));
  const zBallEst = platformZ(ctx.anchors.ballastX, (ballW + 4) / 2 + 2, ballL + 24);
  const ballH = Math.min(Math.max(6, D * 1000 - zBallEst - 12),
    Math.max(8, Math.ceil(need * 1000 / (ballW * ballL)) + 2));
  let T = trayPocket(ballL, ballW + 4, ballH, [0]).concat(
    lug(-ballL / 2, 0, -ballL / 2 - 5, 0, 3), lug(ballL / 2, 0, ballL / 2 + 5, 0, 3));
  grounded('fit_ballast', `Карман балласта (${ctx.ballast || 0} г дроби или гаек М8)`,
    T, ctx.anchors.ballastX, 0, (ballW + 4) / 2 + 2, ballL + 24,
    'клеится на киль до герметизации; засыпка проливается эпоксидкой', { ballH, ballL, ballW });
  T = fBox(0, 0, 0.8, ballL + 5, ballW + 9, 1.6)
    .concat(fBox(-ballL / 2 + 4, 0, 2.6, 4, ballW - 2, 2), fBox(ballL / 2 - 4, 0, 2.6, 4, ballW - 2, 2));
  const bz = out.find(f => f.id === 'fit_ballast');
  add('fit_ballast_lid', 'Крышка кармана балласта', T,
    { x: ctx.anchors.ballastX, y: 0, z: (bz ? bz.place.z : 10) + ballH },
    'кладётся после засыпки, по периметру эпоксидка');

  // опоры дейдвудной трубки на подошвах; в тесной корме, где опора не
  // помещается по ширине, она пропускается — там трубку держит эпоксидная
  // галтель самого выхода через обшивку
  (ctx.shaftMM || []).forEach((s, si) => {
    [['a', 0.45], ['b', 0.8]].forEach(([tag, tf]) => {
      const x = s.x1 + (s.x2 - s.x1) * tf, z = s.z1 + (s.z2 - s.z1) * tf;
      const dv = vCradle(5, 12, 1);
      const zTop = Math.max(keelZ(x) + 1, z - dv.axisZ);
      const needHalf = Math.abs(s.y) + dv.w / 2 + 1.5;
      for (const xo of [-7, 0, 7]) for (const zo of [0, dv.h / 2, dv.h])
        if (yInAt(x + xo, zTop + zo) < needHalf) return;
      const sole = soleFor(x, Math.abs(s.y) + dv.w / 2, 14, zTop);
      add('fit_dw' + (si + 1) + tag,
        `Опора дейдвудной трубки ${si + 1}-го вала (${tag === 'a' ? 'кормовая' : 'носовая'})`,
        dv.tris.concat(fMove(sole, 0, -s.y, -zTop)),
        { x, y: s.y, z: zTop },
        'трубка в V-вырез, всё проливается эпоксидкой');
    });
  });

  // палуба с комингсом и крышка люка
  if (ctx.deckPts && ctx.hatch) {
    const dp = deckParts(ctx.deckPts, ctx.hatch, Math.max(1.2, wallMM));
    add('fit_deck', 'Палуба с комингсом люка и бобышками (клеится на планширь)',
      dp.deck, { x: 0, y: 0, z: D * 1000 }, // геометрия в абсолютных x
      'палуба вклеивается герметично; доступ внутрь — только через люк', { absolute: true });
    add('fit_hatch', 'Крышка люка (4 винта М2 в бобышки, под ней прокладка)',
      dp.lid, { x: 0, y: 0, z: D * 1000 + 7 + 0.5 },
      'силиконовый шнур в зазор комингса, винты по углам', { absolute: true });
  }

  // стапель: два ложемента по наружным обводам
  for (const [tag, fx] of [['fit_stand1', 0.30], ['fit_stand2', 0.65]]) {
    const st = hullStations[Math.round(fx * (hullStations.length - 1))];
    const cw = B * 1000 + 24, ch = D * 1000 * 0.55 + 14;
    const prof = [[-cw / 2, 0], [cw / 2, 0], [cw / 2, ch]];
    const zTop = D * 0.55;
    for (let k = st.pts.length - 1; k >= 0; k--) {
      const p = st.pts[k];
      if (p.z > zTop) continue;
      prof.push([p.y * 1000 + 0.8, ch - (zTop - p.z) * 1000]);
    }
    for (let k = 0; k < st.pts.length; k++) {
      const p = st.pts[k];
      if (p.z > zTop) continue;
      prof.push([-p.y * 1000 - 0.8, ch - (zTop - p.z) * 1000]);
    }
    prof.push([-cw / 2, ch]);
    add(tag, tag === 'fit_stand1' ? 'Стапель, кормовой ложемент (по обводам)' : 'Стапель, носовой ложемент',
      fPrism(prof, 0, 6), null,
      'подставка для стола и испытаний; склеить с рейкой-основанием');
  }
  return out;
}

/* салазки с карманами и пара направляющих С-профилей */
function sledAndRails(slots, W) {
  const t = 2.4, base = 2.0, gap = 5, wallH = 7;
  const sledLen = slots.reduce((s, sl) => s + sl.L + gap, gap) + 2 * t;
  let sled = trayPocket(sledLen, W, wallH, []);
  let cx = -sledLen / 2 + t + gap / 2;
  const offsets = [];
  for (let i = 0; i < slots.length; i++) {
    cx += slots[i].L / 2;
    offsets.push(cx);
    cx += slots[i].L / 2 + gap;
    if (i < slots.length - 1)
      sled = sled.concat(fBox(cx - gap / 2, 0, base - 0.3 + wallH / 2 + 0.3, t, W - 2 * t - 0.3, wallH + 0.6));
  }
  sled = sled.concat(
    fBox(0, W / 2 + 1.4, 1.0, sledLen, 3, 2),
    fBox(0, -W / 2 - 1.4, 1.0, sledLen, 3, 2),
  );
  const railLen = sledLen + 8;
  const prof = [[0, 0], [8, 0], [8, 6], [4.5, 6], [4.5, 4.2], [0, 4.2]];
  const railR0 = fPrismX(prof.map(p => [p[0] + W / 2 - 0.6, p[1]]), -railLen / 2, railLen / 2);
  const railL0 = fPrismX(prof.map(p => [-(p[0] + W / 2 - 0.6), p[1]]).reverse(), -railLen / 2, railLen / 2);
  return { sled, railR: railR0, railL: railL0, sledLen, sledW: W, offsets, boardSeat: 4, railSeat: 2 };
}

/* раскладка деталей на «столе» и единый STL */
function fittingsMesh(fittings) {
  let x = 0;
  const all = [];
  for (const f of fittings) {
    let minX = 1e9, minZ = 1e9;
    for (const t of f.tris) for (const p of t) { minX = Math.min(minX, p[0]); minZ = Math.min(minZ, p[2]); }
    all.push(...fMove(f.tris, x - minX, 0, -minZ));
    x += f.dims[0] + 8;
  }
  return all;
}

if (typeof module !== 'undefined') {
  module.exports = {
    fBox, fRing, fPrism, fPrismX, fPrismY, fMove, fRotY, fRotX, earClip,
    buildFittings, fittingsMesh, meshVolumeCm3, vCradle, trayPocket,
    pedestal, nacaLoop, propMesh, deckParts, sledAndRails, lug, zipBridge,
  };
}
