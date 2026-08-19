/* Общий слой клиентских скриптов сайта: то, что раньше лежало одинаковыми
 * копиями в basin.js, roll.js, pitching.js и stabilizers.js — форматирование
 * чисел, физические постоянные, палитра схем и мелочи для SVG.
 * Подключается тегом <script> ПЕРЕД этими файлами.
 *
 * На страницах решателя (solver, modern) не подключается: там работает
 * движок эпюров geo.js, в котором свои fmt и clamp с другим округлением
 * (fmt без обязательных знаков после запятой), и объединять их нельзя —
 * поменялись бы числа в таблицах. */
'use strict';

const $ = id => document.getElementById(id);

/* ---------- постоянные ---------- */
const G = 9.81;                                    // ускорение свободного падения, м/с²
const RHO = 1.025;                                 // плотность морской воды, т/м³
const D2R = Math.PI / 180, R2D = 180 / Math.PI;    // градусы ↔ радианы
const KN = 0.5144;                                 // узел, м/с

/* палитра схем: ось, акцент, красный, зелёный, синий */
const AX = '#6b6b74', ACC = '#155e75', RED = '#b3382e', GRN = '#1a7f37', BLU = '#2b4fa0';

/* ---------- числа ---------- */
/* число с фиксированным количеством знаков после запятой, по-русски */
const fmt = (v, d = 2) => (isFinite(v)
  ? v.toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d })
  : '—');

/* число в виде 2,65·10⁶ */
function fmtE(v, d = 2) {
  if (!isFinite(v) || v === 0) return '0';
  const e = Math.floor(Math.log10(Math.abs(v)));
  const m = v / Math.pow(10, e);
  const sup = String(e).replace('-', '⁻').replace(/\d/g, c => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+c]);
  return fmt(m, d) + '·10' + sup;
}

/* ограничение значения отрезком [a, b] (всюду вызывается при a < b) */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* ---------- разметка результатов ---------- */
/* строка пошагового решения: формула = подстановка = результат */
function stepRow(f, sub, res, id) {
  return `<div style="margin:5px 0;font:14px system-ui"><span style="color:#3a3a42">${f}</span>` +
    (sub ? ` = <span style="color:#6b6b74">${sub}</span>` : '') +
    ` = <b${id ? ` id="${id}"` : ''}>${res}</b></div>`;
}

/* карточка «величина — значение» в блоке живых показаний */
const cell = (k, v, cls) =>
  `<div class="cell"><span class="k">${k}</span><span class="v"${cls ? ` style="color:${cls}"` : ''}>${v}</span></div>`;

/* ---------- SVG ---------- */
/* инлайн-стиль текста на схеме */
const fs = (size, fill) => `font:${size}px system-ui;fill:${fill}`;

/* ломаная по точкам [x, y] с экранными масштабами X() и Y() */
const poly = (pts, X, Y) => pts.map((p, i) =>
  (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1)).join(' ');

/* рисуем только то, что на экране: экономит батарею на длинной странице */
function onScreen(el) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.bottom > -60 && r.top < (window.innerHeight || 800) + 60;
}
