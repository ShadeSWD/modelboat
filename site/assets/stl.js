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
 * от палубы правого борта через киль к палубе левого борта, мм */
function fullContour(st, scale) {
  const right = st.pts.map(p => [p.y * scale, p.z * scale]);
  const left = st.pts.map(p => [-p.y * scale, p.z * scale]).reverse();
  return right.slice().reverse().concat(left); // палуба ПрБ → киль → палуба ЛБ
}

/* смещение U-контура внутрь на w (мм): нормали усредняются по соседним
 * сегментам; y прижимается к нулю, дно поднимается */
function offsetContour(c, w) {
  const n = c.length, out = [];
  for (let i = 0; i < n; i++) {
    const a = c[Math.max(0, i - 1)], b = c[i], d = c[Math.min(n - 1, i + 1)];
    let tx = d[0] - a[0], ty = d[1] - a[1];
    const len = Math.hypot(tx, ty) || 1;
    // нормаль к контуру, направленная внутрь корпуса (контур идёт ПрБ→ЛБ)
    let nx = -ty / len, ny = tx / len;
    let y = b[0] + nx * w, z = b[1] + ny * w;
    // не пересекать ДП: правая половина остаётся правой, левая — левой
    if (b[0] > 1e-6 && y < 0) y = 0;
    if (b[0] < -1e-6 && y > 0) y = 0;
    out.push([y, z]);
  }
  return out;
}

/* треугольники ленты между двумя контурами одинаковой длины */
function stitch(tris, c0, x0, c1, x1, flip) {
  for (let i = 0; i < c0.length - 1; i++) {
    const A = [x0, c0[i][0], c0[i][1]], B = [x0, c0[i + 1][0], c0[i + 1][1]];
    const C = [x1, c1[i][0], c1[i][1]], D = [x1, c1[i + 1][0], c1[i + 1][1]];
    if (!flip) { tris.push([A, C, B], [B, C, D]); }
    else { tris.push([A, B, C], [B, D, C]); }
  }
}

/* корпус → массив треугольников [[x,y,z]×3] в мм */
function hullMesh(hull, wallM) {
  const scale = 1000, w = wallM * 1000;
  const S = hull.stations;
  const outer = S.map(st => fullContour(st, scale));
  const inner = S.map((st, i) => {
    const bmax = Math.max(...st.pts.map(p => p.y)) * scale;
    if (bmax < 2.5 * w) { // нос/оконечность: монолит, контур в ДП
      return outer[i].map(([y, z]) => [0, Math.min(z + w, outer[i][0][1])]);
    }
    return offsetContour(outer[i], w);
  });
  const tris = [];
  for (let i = 0; i < S.length - 1; i++) {
    const x0 = S[i].x * scale, x1 = S[i + 1].x * scale;
    stitch(tris, outer[i], x0, outer[i + 1], x1, false);   // наружная
    stitch(tris, inner[i], x0, inner[i + 1], x1, true);    // внутренняя (нормали внутрь)
  }
  // транец (станция 0) и форштевень (последняя): кольцо наружный↔внутренний
  const ring = (o, inn, x, flip) => {
    for (let i = 0; i < o.length - 1; i++) {
      const A = [x, o[i][0], o[i][1]], B = [x, o[i + 1][0], o[i + 1][1]];
      const C = [x, inn[i][0], inn[i][1]], D = [x, inn[i + 1][0], inn[i + 1][1]];
      if (!flip) { tris.push([A, B, C], [B, D, C]); }
      else { tris.push([A, C, B], [B, C, D]); }
    }
  };
  ring(outer[0], inner[0], S[0].x * scale, false);
  ring(outer[S.length - 1], inner[S.length - 1], S[S.length - 1].x * scale, true);
  // планширь: две ленты по кромке палубы (первая и последняя точки контуров)
  for (let i = 0; i < S.length - 1; i++) {
    const x0 = S[i].x * scale, x1 = S[i + 1].x * scale;
    for (const k of [0, outer[i].length - 1]) {
      const A = [x0, outer[i][k][0], outer[i][k][1]], B = [x1, outer[i + 1][k][0], outer[i + 1][k][1]];
      const C = [x0, inner[i][k][0], inner[i][k][1]], D = [x1, inner[i + 1][k][0], inner[i + 1][k][1]];
      (k === 0) ? tris.push([A, B, C], [B, D, C]) : tris.push([A, C, B], [B, C, D]);
    }
  }
  // выше обход получился «нормалями внутрь» (проверено интегралом объёма) —
  // разворачиваем все треугольники наружу
  return tris.map(t => [t[0], t[2], t[1]]);
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
