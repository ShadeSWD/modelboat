# -*- coding: utf-8 -*-
"""Численная валидация расчётного ядра (hull.js) через node.

Эталон — аналитический корпус Вигли y = B/2·(1−ξ²)·(1−ζ²):
  * объём V = (4/9)·L·B·T (точное значение);
  * метацентрический радиус r = I_x/V, I_x = 2/3·(B/2)³·(L/2)·(32/35);
  * равновесная осадка при Δ = ρ·V должна вернуть исходное T;
  * плечо ДСО при 5° должно совпадать с h·sin 5° (метацентрическая формула).
"""
import json
import os
import shutil
import subprocess

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SCRIPT = r"""
const H = require(process.argv[1] + '/site/assets/hull.js');
const L = 1.0, B = 0.2, D = 0.2, T = 0.1;
const h = H.makeHull('wigley', {L, B, D});
const hy = H.hydrostatics(h, T);
const Vth = 4 / 9 * L * B * T;
const Ix = 2 / 3 * Math.pow(B / 2, 3) * (L / 2) * (32 / 35);
const eq = H.equilibrium(h, 998 * Vth, L / 2, 0.08);
const gz = H.gzCurve(h, 998 * Vth, 0.08, 10);
console.log(JSON.stringify({
  dV: (hy.V - Vth) / Vth,
  dBM: (hy.BMt - Ix / Vth) / (Ix / Vth),
  dT: (eq.T - T) / T,
  psi: eq.psiDeg,
  gz5: gz[1].gz,
  gzTh: eq.GMt * Math.sin(5 * Math.PI / 180),
}));
"""


@pytest.mark.skipif(shutil.which('node') is None, reason='node не установлен')
def test_wigley():
    out = subprocess.run(['node', '-e', SCRIPT, ROOT],
                         capture_output=True, text=True, check=True)
    r = json.loads(out.stdout)
    assert abs(r['dV']) < 0.01, 'объём Вигли разошёлся с аналитикой'
    assert abs(r['dBM']) < 0.01, 'метацентрический радиус разошёлся'
    assert abs(r['dT']) < 0.01, 'равновесная осадка не сошлась'
    assert abs(r['psi']) < 0.05, 'ложный дифферент при ЦТ в миделе'
    assert r['gz5'] > 0, 'знак плеча ДСО неверен'
    assert abs(r['gz5'] - r['gzTh']) / r['gzTh'] < 0.2, \
        'плечо при 5° не согласуется с метацентрической формулой'
