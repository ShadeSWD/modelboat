/* Общий каркас страниц кластера учебных сайтов СПбГМТУ.
 *
 * Раньше машинерия шапки (построение навигации с выпадашками, вставка
 * header, onReady, подвал, общие SVG-маркеры стрелок) была скопирована в
 * site.js каждого сайта. Копии разошлись — отсюда «разные кнопки в одном
 * разделе» и «прыгающая шапка». Здесь она одна на кластер; site.js сайта
 * содержит только данные и один вызов buildSiteShell().
 *
 * Мастер лежит в cluster-infra/www/shell.js и раскладывается:
 *   * на домен  → /var/www/duckdns-root/shell.js  (отдаётся как /shell.js);
 *   * в каждый репозиторий → site/assets/shell.js (tools/sync-shared.py),
 *     чтобы сайт оставался самодостаточным и работал вне кластера.
 * Страницы подключают ОТНОСИТЕЛЬНУЮ копию строкой перед site.js —
 * синхронно, до разбора остального body, поэтому шапка строится ровно там
 * же, где и раньше, и не «прыгает».
 *
 * buildSiteShell({root, page, brand, logo, home, nav, footer, markers,
 *                 markersFirst, favicon})
 *   root         — префикс относительных ссылок ('./', '../');
 *   page         — значение data-page текущей страницы (подсветка пункта);
 *   brand        — текст рядом с логотипом;
 *   logo         — HTML логотипа (инлайновый SVG или <span> с эмодзи);
 *   home         — что дописать к root в ссылке логотипа ('' или 'index');
 *   nav          — массив пунктов, см. ниже;
 *   footer       — HTML внутренностей <div class="wrap"> подвала;
 *   markers      — HTML <marker>…</marker> для общего скрытого <svg><defs>;
 *   markersFirst — вставить defs первым узлом body, а не в конец;
 *   favicon      — эмодзи для data-URI фавикона (если её нет в <head>).
 *
 * Пункт навигации: { h, k, t, act?, drop? }
 *   h — href без префикса; k — значение data-page для подсветки;
 *   t — подпись; act(page) — своё правило подсветки (когда одного
 *   совпадения k мало: раздел подсвечивается на всех вложенных страницах);
 *   drop — массив вложенных пунктов той же формы (выпадашка).
 */
'use strict';
(function (global) {
  const SVG_NS = 'http://www.w3.org/2000/svg';

  /* Выполнить, когда DOM готов. Каркас строит шапку синхронно (иначе она
     «прыгает»), а подвал и defs добавляет уже по готовности документа. */
  const onReady = (fn) => (document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', fn)
    : fn());

  const isOn = (it, page) =>
    (typeof it.act === 'function' ? !!it.act(page) : page === it.k);

  const navLink = (it, root, page) =>
    `<a href="${root}${it.h}" class="${isOn(it, page) ? 'on' : ''}">${it.t}</a>`;

  const navHtml = (nav, root, page) => nav.map((g) => {
    if (!g.drop) return navLink(g, root, page);
    const on = isOn(g, page) || g.drop.some((it) => isOn(it, page)) ? 'on' : '';
    return `<span class="nav-drop"><a href="${root}${g.h}" class="${on}">${g.t} ▾</a>`
      + `<span class="drop">${g.drop.map((it) => navLink(it, root, page)).join('')}</span></span>`;
  }).join('');

  function buildSiteShell(opt) {
    const o = opt || {};
    const root = o.root || './';
    const page = o.page || '';

    const header = document.createElement('header');
    header.className = 'site';
    header.innerHTML = `<div class="wrap">
    <a class="logo" href="${root}${o.home || ''}">${o.logo || ''}<span>${o.brand || ''}</span></a>
    <nav class="top">${navHtml(o.nav || [], root, page)}</nav>
  </div>`;
    document.body.prepend(header);

    if (o.footer) {
      const footer = document.createElement('footer');
      footer.className = 'site';
      footer.innerHTML = `<div class="wrap">${o.footer}</div>`;
      onReady(() => document.body.appendChild(footer));
    }

    if (o.markers) {
      const defs = document.createElementNS(SVG_NS, 'svg');
      defs.setAttribute('width', '0');
      defs.setAttribute('height', '0');
      defs.setAttribute('aria-hidden', 'true');
      defs.style.position = 'absolute';
      defs.innerHTML = `<defs>${o.markers}</defs>`;
      // некоторым сайтам маркеры нужны первым узлом body (исторический порядок)
      if (o.markersFirst) document.body.prepend(defs);
      else onReady(() => document.body.appendChild(defs));
    }

    if (o.favicon && !document.querySelector('link[rel~="icon"]')) {
      const fav = document.createElement('link');
      fav.rel = 'icon';
      fav.href = 'data:image/svg+xml,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        + `<text y=".9em" font-size="88">${o.favicon}</text></svg>`);
      document.head.appendChild(fav);
    }

    return header;
  }

  buildSiteShell.onReady = onReady;
  global.buildSiteShell = buildSiteShell;
})(window);
