# -*- coding: utf-8 -*-
"""Железная проверка непересечения деталей с корпусом.

Скрипт tests/clearance_check.js собирает конструктор в node по сетке
конфигураций (3 прототипа × 3 длины × 3 полноты) и для КАЖДОЙ вершины
КАЖДОЙ детали сборки проверяет, что она лежит внутри внутренней
поверхности корпуса (допуск 1,2 мм; исключения — дейдвуд, винт, перо руля,
палуба с крышкой, для которых выход предусмотрен конструкцией).
Любое нарушение — красный тест.
"""
import json
import os
import shutil
import subprocess

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@pytest.mark.skipif(shutil.which('node') is None, reason='node не установлен')
def test_no_hull_intersections():
    r = subprocess.run(
        ['node', os.path.join(ROOT, 'tests', 'clearance_check.js'), ROOT],
        capture_output=True, text=True)
    data = json.loads(r.stdout)
    assert data['total'] >= 27, 'сетка конфигураций не отработала целиком'
    assert not data['bad'], (
        'детали пересекаются с корпусом:\n' +
        '\n'.join(f"{b['cfg']}: " + '; '.join(
            f"{v['name']} ({v['where']}, {v['depth']} мм)" for v in b['viol'])
            for b in data['bad']))
    assert r.returncode == 0
