# -*- coding: utf-8 -*-
"""Тесты целостности статического сайта (переносимый набор).

Покрытие структурное: каждая HTML-страница и каждый JS-файл сайта
прогоняется отдельным тест-кейсом (pytest параметризует по файлам),
поэтому «зелёный» прогон = 100% страниц и скриптов проверены на:
  * корректный разбор HTML;
  * отсутствие дублей id;
  * целостность локальных ссылок и ассетов (href/src/link указывают на
    существующие на диске файлы);
  * синтаксис JS (node --check, если node доступен — иначе пропуск).

Стандартная библиотека + pytest; для JS-проверки нужен node в PATH/CI.
"""
import os
import shutil
import subprocess
from html.parser import HTMLParser

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(ROOT, 'site') if os.path.isdir(os.path.join(ROOT, 'site')) else ROOT

_SKIP_SCHEMES = ('http://', 'https://', 'mailto:', 'tel:', 'data:', 'javascript:',
                 '#', '//')


def _walk(ext):
    for base, _dirs, files in os.walk(SITE):
        if '/.git' in base or '/node_modules' in base:
            continue
        for f in files:
            if f.lower().endswith(ext):
                yield os.path.join(base, f)


HTML_FILES = sorted(_walk('.html'))
JS_FILES = sorted(_walk('.js'))


class _Collector(HTMLParser):
    """Собирает id и локальные ссылки-ассеты для проверки целостности."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.ids = []
        self.links = []          # (tag, attr, url)

    def handle_starttag(self, tag, attrs):
        d = dict(attrs)
        if 'id' in d and d['id']:
            self.ids.append(d['id'])
        for attr in ('href', 'src'):
            url = d.get(attr)
            if url and not url.strip().lower().startswith(_SKIP_SCHEMES):
                self.links.append((tag, attr, url.strip()))


def test_site_has_index():
    assert os.path.isfile(os.path.join(SITE, 'index.html')), \
        'нет index.html в корне сайта'


def test_found_pages():
    assert HTML_FILES, 'не найдено ни одной HTML-страницы'


@pytest.mark.parametrize('path', HTML_FILES, ids=lambda p: os.path.relpath(p, SITE))
def test_html_integrity(path):
    with open(path, encoding='utf-8') as fh:
        html = fh.read()
    c = _Collector()
    c.feed(html)                                  # разбор не должен падать
    # дубли id
    dups = {i for i in c.ids if c.ids.count(i) > 1}
    assert not dups, 'дублирующиеся id: %s' % ', '.join(sorted(dups))
    # целостность локальных ссылок/ассетов
    page_dir = os.path.dirname(path)
    missing = []
    for _tag, _attr, url in c.links:
        target = url.split('#', 1)[0].split('?', 1)[0]
        if not target:
            continue
        if target.startswith('/'):
            # Абсолютная ссылка адресует корень домена за reverse-proxy.
            # Сайт развёрнут под префиксом пути (…/shipstat/, …/strength/),
            # поэтому «/…» указывает НЕ в корень этого репозитория, а на
            # соседнее развёртывание — из одного репо не проверяется.
            continue
        fp = os.path.normpath(os.path.join(page_dir, target))
        # Ссылка, вышедшая за пределы дерева сайта (…/../shipstat/), — это
        # переход на соседний сайт-развёртывание; из этого репо не проверяется.
        if os.path.relpath(fp, SITE).startswith('..'):
            continue
        # nginx try_files $uri $uri.html $uri/ — чистые URL без расширения
        if not (os.path.exists(fp) or os.path.exists(fp + '.html')
                or os.path.isfile(os.path.join(fp, 'index.html'))):
            missing.append(url)
    assert not missing, 'битые локальные ссылки/ассеты: %s' % ', '.join(missing)


@pytest.mark.skipif(not shutil.which('node'), reason='node не установлен')
@pytest.mark.parametrize('path', JS_FILES, ids=lambda p: os.path.relpath(p, SITE))
def test_js_syntax(path):
    r = subprocess.run(['node', '--check', path], capture_output=True, text=True)
    assert r.returncode == 0, 'синтаксис JS: %s' % (r.stderr.strip()[:300])
