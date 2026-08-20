/* Железная проверка: по сетке конфигураций ни одна деталь не выходит
 * из корпуса. Запускается из pytest (tests/test_clearance.py). */
'use strict';
const path = process.argv[1] ? process.argv[2] : '.';
const H = require(path + '/site/assets/hull.js');
Object.assign(global, H);
global.yAt = H.yAt;
Object.assign(global, require(path + '/site/assets/stl.js'));
Object.assign(global, require(path + '/site/assets/fittings.js'));
const B = require(path + '/site/assets/boat.js');

const results = [];
for (const proto of ['tug', 'launch', 'cargo']) {
  for (const L of [350, 450, 600]) {
    for (const full of [0.8, 1.0, 1.2]) {
      Object.assign(B.state, {
        proto, L, LB: 5.2, DB: 0.85, full, transom: 1, bow: 1,
        wall: 1.6, mat: 'pla', ballast: 350, ballastFx: 0.48, pos: {},
      });
      const r = B.compute();
      const viol = B.clearanceViolations(r, B.assemblyParts(r, { noHull: true }));
      results.push({
        cfg: `${proto} L${L} full${full}`,
        viol: viol.map(v => ({ name: v.name.slice(0, 60), depth: +v.depth.toFixed(1), where: v.where })),
      });
    }
  }
}
const bad = results.filter(r => r.viol.length);
console.log(JSON.stringify({ total: results.length, bad }, null, 1));
process.exit(bad.length ? 1 : 0);
