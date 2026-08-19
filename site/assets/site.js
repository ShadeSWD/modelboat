/* Данные каркаса страниц «Модель судна для 3D-печати». Машинерия — assets/shell.js. */
'use strict';
(function () {
  const me = document.currentScript;
  buildSiteShell({
    root: (me && me.dataset.root) || './',
    page: (me && me.dataset.page) || '',
    brand: 'Модель судна',
    logo: `
  <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
    <rect x="1" y="1" width="28" height="28" rx="6" fill="#0e6b5e"/>
    <path d="M5 18 L 25 18 L 21 24 L 9 24 Z" fill="#fff"/>
    <rect x="12" y="12" width="7" height="5" rx="1" fill="#fff"/>
    <line x1="15.5" y1="12" x2="15.5" y2="6" stroke="#e2a13b" stroke-width="2"/>
    <path d="M4 20 Q 8 17 12 20" stroke="#8fd3c7" stroke-width="1.6" fill="none"/>
    <path d="M19 21 Q 23 18 27 21" stroke="#8fd3c7" stroke-width="1.6" fill="none"/>
  </svg>`,
    nav: [
      { h: '', k: 'index', t: 'Обзор' },
      { h: 'designer', k: 'designer', t: 'Конструктор' },
      { h: 'parts', k: 'parts', t: 'Компоненты' },
      { t: 'Постройка', h: 'build', act: p => ['build', 'seal', 'trials'].includes(p), drop: [
        { h: 'build', k: 'build', t: 'Печать и сборка' },
        { h: 'seal', k: 'seal', t: 'Герметизация и покрытие' },
        { h: 'trials', k: 'trials', t: 'Испытания' },
      ] },
      { t: 'Управление', h: 'control', act: p => ['control', 'panel'].includes(p), drop: [
        { h: 'control', k: 'control', t: 'Электроника и прошивка' },
        { h: 'panel', k: 'panel', t: 'Пульт в браузере' },
      ] },
      { h: 'kompas', k: 'kompas', t: 'КОМПАС-3D' },
      { h: 'theory', k: 'theory', t: 'Методика расчёта' },
      { h: 'sources', k: 'sources', t: 'Источники' },
    ],
    footer: `<div>Проектирование, расчёт и постройка радиоуправляемой модели судна, напечатанной на 3D-принтере</div>`,
    markers: `<marker id="arrE" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
      <path d="M0,0 L10,4 L0,8 z" fill="#16161a"/></marker>
    <marker id="arrS" markerWidth="10" markerHeight="8" refX="1" refY="4" orient="auto">
      <path d="M10,0 L0,4 L10,8 z" fill="#16161a"/></marker>`,
  });
})();
