/* Экспорт геометрии корпуса: бинарный STL (полая оболочка с толщиной
 * стенки, открытая палуба — сразу на печать), boat.json для макроса
 * КОМПАС-3D и CSV-таблица ординат. Размеры в файлах — миллиметры.
 *
 * Оболочка: наружный контур каждой станции смещается внутрь по нормали
 * на толщину стенки; сетка сшивается лентами квадов: наружная поверхность,
 * внутренняя, транец, форштевень и планширь (кромка палубы). В носу, где
 * ширина меньше двух толщин, внутренний контур схлопывается в ДП —
 * получается монолитный форштевень, топология сетки не рвётся. */
'use strict';

/* контур станции (правый борт, от киля до палубы) → полный U-контур
 * от палубы правого борта через киль к палубе левого борта, мм.
 * wStem — минимальная полуширота: контур нигде не схлопывается в линию
 * (в носу получается стем конечной ширины, у киля — узкий плоский след),
 * поэтому топология сетки везде одинакова и оболочка гарантированно
 * замкнута без вырожденных треугольников. */
function fullContour(st, scale, wStem) {
  const w = wStem || 0;
  const right = st.pts.map(p => [Math.max(p.y * scale, w), p.z * scale]);
  const left = right.map(p => [-p[0], p[1]]);
  // палуба ПрБ → вниз к килю (+y) → через дно → киль (−y) → вверх к палубе ЛБ:
  // непрерывная U-образная ломаная (раньше вторая ветвь шла в обратную
  // сторону — между килем и палубой возникала фантомная мембрана)
  return right.slice().reverse().concat(left);
}

/* смещение U-контура внутрь на w (мм): нормали усредняются по соседним
 * сегментам, затем санация — внутренняя точка обязана остаться строго
 * внутри наружной (иначе при остром киле смещение самопересекается) */
function offsetContour(c, w) {
  const n = c.length, out = [];
  for (let i = 0; i < n; i++) {
    const a = c[Math.max(0, i - 1)], b = c[i], d = c[Math.min(n - 1, i + 1)];
    let tx = d[0] - a[0], ty = d[1] - a[1];
    const len = Math.hypot(tx, ty) || 1;
    // нормаль внутрь корпуса: обход ПрБ-вниз → дно → ЛБ-вверх
    let nx = ty / len, ny = -tx / len;
    let y = b[0] + nx * w, z = b[1] + ny * w;
    const side = Math.sign(b[0]);
    const yAbs = Math.abs(b[0]);
    let yi = side * y > 0 ? Math.abs(y) : 0.001;      // не пересекать ДП
    yi = Math.min(yi, Math.max(0.001, yAbs - 0.4));   // строго внутри борта
    yi = Math.max(yi, Math.min(0.3, yAbs * 0.25));    // и не в нуле
    z = Math.max(z, b[1] - 0.0001);                   // дно только поднимается
    out.push([side >= 0 ? yi : -yi, z]);
  }
  return out;
}

/* корпус → массив треугольников [[x,y,z]×3] в мм.
 * Пять лент: наружная поверхность, внутренняя, транец, форштевень,
 * планширь (обе кромки палубы). Развороты обхода подобраны так, что
 * ориентация согласована по всей сетке (проверка: каждое направленное
 * ребро встречается ровно один раз, объём положительный и равен
 * площадь × стенка). */
function hullMesh(hull, wallM) {
  const scale = 1000, w = wallM * 1000;
  const wStem = w + 0.8; // минимальная полуширота наружного контура (стем)
  const S = hull.stations;
  const outer = S.map(st => fullContour(st, scale, wStem));
  const inner = outer.map(c => offsetContour(c, w));
  const N = S.length, M = outer[0].length;
  // транец и форштевень — СТЕНКИ толщиной w: наружная крышка в торце,
  // внутренняя поверхность начинается с отступом w и закрыта своей крышкой
  const X = i => Math.min(Math.max(S[i].x * scale, w), S[N - 1].x * scale - w);
  const Xo = i => S[i].x * scale;
  const tris = [];
  const quad = (P1, P2, P3, P4, flip) => {
    if (flip) tris.push([P1, P3, P2], [P1, P4, P3]);
    else tris.push([P1, P2, P3], [P1, P3, P4]);
  };
  for (let i = 0; i < N - 1; i++) for (let k = 0; k < M - 1; k++) {
    quad([Xo(i), ...outer[i][k]], [Xo(i), ...outer[i][k + 1]],
      [Xo(i + 1), ...outer[i + 1][k + 1]], [Xo(i + 1), ...outer[i + 1][k]], true);
    quad([X(i), ...inner[i][k]], [X(i), ...inner[i][k + 1]],
      [X(i + 1), ...inner[i + 1][k + 1]], [X(i + 1), ...inner[i + 1][k]], false);
  }
  // торцевые крышки: полигон U-контура, замкнутый по палубе, веером от ДП
  const cap = (c, x, flip) => {
    const mid = [x, 0, c[0][1]]; // точка на линии палубы в ДП
    for (let k = 0; k < c.length - 1; k++) {
      const A = [x, ...c[k]], B = [x, ...c[k + 1]];
      if (flip) tris.push([mid, B, A]); else tris.push([mid, A, B]);
    }
  };
  cap(outer[0], Xo(0), false);            // наружная грань транца
  cap(inner[0], X(0), true);              // внутренняя грань транца
  cap(outer[N - 1], Xo(N - 1), true);     // наружная грань форштевня
  cap(inner[N - 1], X(N - 1), false);     // внутренняя грань форштевня
  for (let i = 0; i < N - 1; i++) { // планширь
    quad([Xo(i), ...outer[i][0]], [Xo(i + 1), ...outer[i + 1][0]],
      [X(i + 1), ...inner[i + 1][0]], [X(i), ...inner[i][0]], true);
    quad([Xo(i), ...outer[i][M - 1]], [Xo(i + 1), ...outer[i + 1][M - 1]],
      [X(i + 1), ...inner[i + 1][M - 1]], [X(i), ...inner[i][M - 1]], false);
  }
  // торцевые полоски планширя: между наружной и внутренней кромками палубы
  for (const [io, flip] of [[0, false], [N - 1, true]]) {
    for (const k of [0, M - 1]) {
      const A = [Xo(io), ...outer[io][k]], B2 = [X(io), ...inner[io][k]];
      const Am = [Xo(io), 0, outer[io][0][1]], Bm = [X(io), 0, inner[io][0][1]];
      const f2 = (k === 0) !== flip;
      if (f2) tris.push([A, Bm, B2], [A, Am, Bm]); else tris.push([A, B2, Bm], [A, Bm, Am]);
    }
  }
  return tris;
}

/* бинарный STL из треугольников */
function stlBlob(tris) {
  const buf = new ArrayBuffer(84 + tris.length * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, tris.length, true);
  let o = 84;
  for (const t of tris) {
    const ux = t[1][0] - t[0][0], uy = t[1][1] - t[0][1], uz = t[1][2] - t[0][2];
    const vx = t[2][0] - t[0][0], vy = t[2][1] - t[0][1], vz = t[2][2] - t[0][2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    dv.setFloat32(o, nx / l, true); dv.setFloat32(o + 4, ny / l, true); dv.setFloat32(o + 8, nz / l, true);
    o += 12;
    for (const p of t) {
      dv.setFloat32(o, p[0], true); dv.setFloat32(o + 4, p[1], true); dv.setFloat32(o + 8, p[2], true);
      o += 12;
    }
    o += 2;
  }
  return new Blob([buf], { type: 'model/stl' });
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

/* boat.json по схеме макроса КОМПАС (мм, 21 станция) */
function boatJson(state, hull, comps, shaftLine, rudder) {
  const scale = 1000, S = hull.stations;
  const idx = Array.from({ length: 21 }, (_, i) => Math.round(i / 20 * (S.length - 1)));
  return {
    name: state.name || 'model-boat', kit: state.kit, shafts: hull.proto.shafts,
    L: +(hull.L * scale).toFixed(1), B: +(hull.B * scale).toFixed(1),
    T: +(state.T * scale).toFixed(1), D: +(hull.D * scale).toFixed(1),
    wall: +(state.wall * scale).toFixed(2),
    stations: idx.map(i => ({
      x: +(S[i].x * scale).toFixed(1),
      points: S[i].pts.map(p => [+(p.y * scale).toFixed(2), +(p.z * scale).toFixed(2)]),
    })),
    deck: idx.map(i => ({
      x: +(S[i].x * scale).toFixed(1),
      y: +(S[i].pts[S[i].pts.length - 1].y * scale).toFixed(2),
      z: +(hull.D * scale).toFixed(1),
    })),
    components: comps.map(c => ({
      id: c.id, name: c.name, x: +(c.x * scale).toFixed(1), y: +(c.y * scale).toFixed(1),
      z: +(c.z * scale).toFixed(1), L: c.Lmm, W: c.Wmm, H: c.Hmm,
      shape: c.shape || 'box',
    })),
    shaftLine: shaftLine.map(s => ({
      x1: +(s.x1 * scale).toFixed(1), z1: +(s.z1 * scale).toFixed(1),
      x2: +(s.x2 * scale).toFixed(1), z2: +(s.z2 * scale).toFixed(1),
      y: +(s.y * scale).toFixed(1),
    })),
    rudder: rudder ? {
      x: +(rudder.x * scale).toFixed(1), chord: rudder.chord, span: rudder.span, thick: rudder.thick,
    } : null,
  };
}

/* CSV-таблица ординат: строки — станции, столбцы — ватерлинии */
function offsetsCsv(hull) {
  const S = hull.stations, NZ = 11;
  const zs = Array.from({ length: NZ }, (_, k) => k / (NZ - 1) * hull.D);
  let csv = 'x, мм;' + zs.map(z => 'y при z=' + (z * 1000).toFixed(0) + ' мм').join(';') + '\n';
  for (const st of S) {
    csv += (st.x * 1000).toFixed(1) + ';' +
      zs.map(z => (yAt(st, z) * 1000).toFixed(1)).join(';') + '\n';
  }
  return new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
}

if (typeof module !== 'undefined') {
  module.exports = { hullMesh, stlBlob, boatJson, offsetsCsv, fullContour, offsetContour };
}
