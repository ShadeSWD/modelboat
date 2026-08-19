/* Расчётное ядро модели судна: параметрический корпус + численная
 * гидростатика + массовая нагрузка + прогноз скорости.
 *
 * Корпус задаётся семейством шпангоутных контуров: на каждой станции
 * u = x/L (0 — транец/корма, 1 — форштевень) контур наружной поверхности
 * строится от киля до палубы по полуширотам на конструктивной ватерлинии
 * и на палубе и показателю полноты сечения (U- или V-образность).
 * Всё считается в СИ (метры, килограммы), интерфейс переводит в мм и г.
 *
 * Валидация: для аналитического корпуса Вигли
 * y = B/2·(1−ξ²)·(1−ζ²) объём равен (4/9)·L·B·T — тест в tests/.
 */
'use strict';

const RHO_W = 998;      // плотность пресной воды, кг/м³ (ванна и пруд)
const NST = 41;         // станций по длине
const NZC = 33;         // точек контура по высоте

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

/* таблицы ординат: в браузере — глобал из protodata.js, в node — require */
function protoTables() {
  if (typeof PROTO_TABLES !== 'undefined') return PROTO_TABLES;
  return require('./protodata.js').PROTO_TABLES;
}

/* ---------- интерполяция таблично заданной кривой (монотонный Катмулл—Ром) ---------- */
function curve(knots) {
  // knots: [[u,v],...] по возрастанию u; возвращает f(u)
  const xs = knots.map(k => k[0]), ys = knots.map(k => k[1]);
  return function (u) {
    if (u <= xs[0]) return ys[0];
    if (u >= xs[xs.length - 1]) return ys[ys.length - 1];
    let i = 0;
    while (xs[i + 1] < u) i++;
    const t = (u - xs[i]) / (xs[i + 1] - xs[i]);
    const y0 = ys[Math.max(0, i - 1)], y1 = ys[i], y2 = ys[i + 1],
      y3 = ys[Math.min(ys.length - 1, i + 2)];
    // Катмулл—Ром
    return 0.5 * ((2 * y1) + (-y0 + y2) * t + (2 * y0 - 5 * y1 + 4 * y2 - y3) * t * t +
      (-y0 + 3 * y1 - 3 * y2 + y3) * t * t * t);
  };
}

/* ---------- семейства обводов ----------
 * Каждый прототип: кривые по u (0=корма, 1=нос) в долях:
 *   fd — полуширота на палубе / (B/2);
 *   fw — полуширота на КВЛ / (B/2);
 *   zk — возвышение киля / D;
 *   n  — показатель сечения ниже КВЛ (1 — прямостенный V, <1 — полное U);
 *   Tfrac — конструктивная осадка / D (для формы; фактическая осадка
 *           находится из равновесия).
 * Коэффициенты полноты пересчитываются честно из полученной геометрии. */
const PROTOS = {
  tug: {
    name: 'Буксир (одновальный, полные обводы)',
    about: 'Полные U-образные шпангоуты, подъём киля в корме под гребной винт, высокий борт. Обводы построены по типу портовых буксиров (C_B ≈ 0,50–0,55).',
    shafts: 1, rudder: true, Tfrac: 0.55,
    fd: curve([[0, 0.80], [0.15, 0.94], [0.35, 1.0], [0.65, 1.0], [0.85, 0.90], [1, 0.10]]),
    fw: curve([[0, 0.42], [0.15, 0.80], [0.35, 1.0], [0.60, 1.0], [0.80, 0.72], [0.95, 0.22], [1, 0.0]]),
    zk: curve([[0, 0.38], [0.12, 0.16], [0.25, 0.0], [0.75, 0.0], [0.95, 0.02], [1, 0.30]]),
    n: curve([[0, 2.0], [0.3, 2.8], [0.6, 2.7], [0.85, 1.5], [1, 1.0]]),
    crFn: [[0.10, 0.0006], [0.20, 0.0012], [0.30, 0.0035], [0.40, 0.009], [0.50, 0.016], [0.60, 0.022]],
  },
  launch: {
    name: 'Катер R/V Athena (двухвальный)',
    about: 'Настоящие обводы исследовательского судна R/V Athena (модель DTMB 5365, таблица ординат из отчёта DTRC-89/029): круглоскулый полуглиссирующий корпус с широким погружённым транцем, двухвальный. Руля нет — управление разнотягом винтов.',
    shafts: 2, rudder: false, Tfrac: 1 / 1.5, table: 'athena',
    crFn: [[0.15, 0.0008], [0.30, 0.0022], [0.45, 0.006], [0.60, 0.010], [0.80, 0.012], [1.0, 0.011]],
  },
  cargo: {
    name: 'Транспорт Серии 60 (одновальный)',
    about: 'Обводы родительской модели Серии 60 c C_B = 0,60 — таблица ординат из первоисточника (Тодд, DTMB Report 1712, 1963, модель 4210W): цилиндрическая вставка, подзор кормы, полные трюмы. Медленный, вместительный, устойчивый на курсе.',
    shafts: 1, rudder: true, Tfrac: 1 / 1.5, table: 'series60',
    crFn: [[0.10, 0.0005], [0.18, 0.0010], [0.25, 0.0022], [0.32, 0.006], [0.40, 0.012]],
  },
  wigley: { // служебный, для валидации (в интерфейсе не показывается)
    name: 'Корпус Вигли (аналитический)', about: '', shafts: 1, rudder: true, Tfrac: 0.5,
    analytic: true,
  },
};

/* ---------- построение корпуса ----------
 * makeHull(protoId, dims, morph) → hull
 * dims: {L, B, D} в метрах; morph: {full: 0.7..1.4 (γ полноты),
 * transom: 0.5..1.4 (ширина кормы), bow: 0.7..1.3 (острота носа)}.
 * hull.stations[i] = {x, pts:[{y,z}...NZC от киля до палубы]} — наружная
 * поверхность правого борта. */
function makeHull(protoId, dims, morph) {
  const p = PROTOS[protoId];
  const { L, B, D } = dims;
  const m = Object.assign({ full: 1, transom: 1, bow: 1 }, morph);
  const stations = [];
  for (let i = 0; i < NST; i++) {
    const u = i / (NST - 1);
    const x = u * L;
    const pts = [];
    if (p.analytic) { // корпус Вигли: y = B/2·(1−ξ²)·(1−((T−z)/T)²) при z ≤ T
      const T = p.Tfrac * D, xi = 2 * u - 1;
      const yw = B / 2 * Math.max(0, 1 - xi * xi);
      for (let k = 0; k < NZC; k++) {
        const z = k / (NZC - 1) * D;
        pts.push({ y: z <= T ? yw * (1 - Math.pow((T - z) / T, 2)) : yw, z });
      }
      stations.push({ x, pts });
      continue;
    }
    // морфинг: транец усиливает/ослабляет ширину кормы, нос — приполнение носа
    const wAft = (u < 0.5) ? 1 + (m.transom - 1) * (1 - u / 0.5) : 1;
    const wBow = (u > 0.5) ? 1 + (m.bow - 1) * ((u - 0.5) / 0.5) : 1;
    if (p.table) { // табличный прототип: интерполяция таблицы ординат
      const tb = protoTables()[p.table];
      const Tt = p.Tfrac * D; // конструктивная осадка: таблица доходит до 1,5T = палуба
      const yn = zf => { // нормированная полуширота на этой станции на уровне z/Tt
        // по станциям
        const su = tb.stations;
        let a = 0;
        while (a < su.length - 2 && su[a + 1] < u) a++;
        const tu = clamp01((u - su[a]) / (su[a + 1] - su[a]));
        // по ватерлиниям
        const wl = tb.wl;
        let b = 0;
        const zz = clamp01(zf) * 1.5;
        while (b < wl.length - 2 && wl[b + 1] < zz) b++;
        const tw = clamp01((zz - wl[b]) / (wl[b + 1] - wl[b]));
        const at = tb.hb[a][b] + tw * (tb.hb[a][b + 1] - tb.hb[a][b]);
        const bt = tb.hb[a + 1][b] + tw * (tb.hb[a + 1][b + 1] - tb.hb[a + 1][b]);
        return at + tu * (bt - at);
      };
      // полный столбец значений и отсечка «пустого» низа (подзор, подъём днища)
      const raw = [];
      for (let k = 0; k < NZC; k++) {
        const z = k / (NZC - 1) * D;
        let v = Math.min(1.06, Math.max(0, yn(z / D)));
        v = Math.pow(v / 1.06, 1 / m.full) * 1.06;           // полнота
        v *= (u < 0.5 ? wAft : wBow);                        // корма/нос
        raw.push({ z, y: v * B / 2 });
      }
      let k0 = raw.findIndex(q => q.y > 0.004 * B);
      if (k0 < 0) k0 = raw.length - 1;
      if (k0 > 0) k0--;
      raw[k0] = { z: raw[k0].z, y: 0 };                      // точка киля/контура
      const col = raw.slice(k0);
      while (col.length < NZC) col.unshift({ z: col[0].z, y: 0 });
      stations.push({ x, pts: col.map(q => ({ y: q.y, z: q.z })) });
      continue;
    }
    const bd = B / 2 * Math.min(1, p.fd(u) * wAft * wBow);
    const bw = B / 2 * Math.min(1, p.fw(u) * wAft * wBow);
    const zkeel = p.zk(u) * D;
    const Tf = p.Tfrac * D;
    // сечение ниже КВЛ — суперэллипс y = b·(1−(1−t)^p)^(1/p):
    // p=1 — треугольное V, p=2 — четверть эллипса, p→∞ — прямоугольное U;
    // множитель полноты morph.full > 1 делает сечения полнее
    const pexp = Math.max(0.6, p.n(u) * m.full);
    for (let k = 0; k < NZC; k++) {
      const z = zkeel + k / (NZC - 1) * (D - zkeel);
      let y;
      if (z <= Tf) {
        const t = (Tf - zkeel) < 1e-9 ? 1 : (z - zkeel) / (Tf - zkeel);
        y = bw * Math.pow(1 - Math.pow(1 - Math.max(0, Math.min(1, t)), pexp), 1 / pexp);
      } else {
        const t = (z - Tf) / Math.max(1e-9, D - Tf);
        y = bw + (bd - bw) * t; // прямой развал борта выше КВЛ
      }
      pts.push({ y: Math.max(0, y), z: Math.min(z, D) });
    }
    stations.push({ x, pts });
  }
  return { proto: p, protoId, L, B, D, stations };
}

/* полуширота на станции i на уровне z (линейная по контуру) */
function yAt(st, z) {
  const pts = st.pts;
  if (z <= pts[0].z) return 0;                       // ниже киля
  if (z >= pts[pts.length - 1].z) return pts[pts.length - 1].y;
  for (let k = 0; k < pts.length - 1; k++) {
    if (z <= pts[k + 1].z) {
      const t = (z - pts[k].z) / Math.max(1e-12, pts[k + 1].z - pts[k].z);
      return pts[k].y + t * (pts[k + 1].y - pts[k].y);
    }
  }
  return pts[pts.length - 1].y;
}

/* площадь и статический момент погруженной части шпангоута до осадки T */
function sectionAM(st, T) {
  let a = 0, mz = 0;
  const NZ = 40, z0 = st.pts[0].z;
  if (T <= z0) return { a: 0, mz: 0 };
  for (let k = 0; k < NZ; k++) {
    const za = z0 + k / NZ * (T - z0), zb = z0 + (k + 1) / NZ * (T - z0);
    const da = (yAt(st, za) + yAt(st, zb)) * (zb - za); // полное сечение = 2·средняя полуширота
    a += da; mz += da * (za + zb) / 2;
  }
  return { a, mz };
}

/* ---------- гидростатика при осадке T ---------- */
function hydrostatics(hull, T) {
  const S = hull.stations;
  let V = 0, Mx = 0, Mz = 0, Awl = 0, MxA = 0, Ix = 0, IyRaw = 0, Swet = 0;
  const secA = S.map(st => sectionAM(st, T));
  for (let i = 0; i < S.length - 1; i++) {
    const dx = S[i + 1].x - S[i].x;
    const a0 = secA[i], a1 = secA[i + 1];
    V += (a0.a + a1.a) / 2 * dx;
    Mx += (a0.a * S[i].x + a1.a * S[i + 1].x) / 2 * dx;
    Mz += (a0.mz + a1.mz) / 2 * dx;
    const y0 = yAt(S[i], T), y1 = yAt(S[i + 1], T);
    Awl += (y0 + y1) * dx;                          // 2·средняя/2 → (y0+y1)/2·2
    MxA += (y0 * S[i].x + y1 * S[i + 1].x) * dx;
    Ix += (Math.pow(y0, 3) + Math.pow(y1, 3)) / 3 * dx; // 2/3·y³ трапецией
    IyRaw += (y0 * S[i].x * S[i].x + y1 * S[i + 1].x * S[i + 1].x) * dx;
    // смоченный периметр станции (по контуру до T)
    const g0 = girth(S[i], T), g1 = girth(S[i + 1], T);
    Swet += (g0 + g1) / 2 * dx;
  }
  const xb = V > 1e-12 ? Mx / V : 0;
  const zb = V > 1e-12 ? Mz / V : 0;
  const xf = Awl > 1e-12 ? MxA / Awl : 0;
  const Iyf = IyRaw - Awl * xf * xf;                // перенос оси в ЦТ площади ВЛ
  const BMt = V > 1e-12 ? Ix / V : 0;
  const BMl = V > 1e-12 ? Iyf / V : 0;
  // коэффициенты полноты
  const Lwl = wlLength(hull, T), Bwl = wlBeam(hull, T);
  const Am = Math.max(...secA.map(s => s.a));
  const Cb = (Lwl > 0 && Bwl > 0 && T > 0) ? V / (Lwl * Bwl * (T - keelMin(hull))) : 0;
  const Cm = (Bwl > 0) ? Am / (Bwl * (T - keelMin(hull))) : 0;
  const Cp = Cm > 1e-9 ? Cb / Cm : 0;
  const Cwp = (Lwl > 0 && Bwl > 0) ? Awl / (Lwl * Bwl) : 0;
  return { T, V, Awl, Swet, xb, zb, xf, BMt, BMl, KMt: zb + BMt, Lwl, Bwl, Am, Cb, Cm, Cp, Cwp };
}
function keelMin(hull) { return Math.min(...hull.stations.map(s => s.pts[0].z)); }
function girth(st, T) { // длина контура станции от киля до уровня T (полная, оба борта)
  let g = 0;
  for (let k = 0; k < st.pts.length - 1; k++) {
    const a = st.pts[k], b = st.pts[k + 1];
    if (a.z >= T) break;
    const zb = Math.min(b.z, T);
    const t = (zb - a.z) / Math.max(1e-12, b.z - a.z);
    const yb = a.y + t * (b.y - a.y);
    g += Math.hypot(yb - a.y, zb - a.z);
  }
  return 2 * g + 2 * st.pts[0].y; // оба борта + плоское днище (2·полуширота у киля)
}
function wlLength(hull, T) {
  const S = hull.stations;
  let x0 = null, x1 = null;
  for (const st of S) if (yAt(st, T) > 1e-4) { if (x0 === null) x0 = st.x; x1 = st.x; }
  return x0 === null ? 0 : x1 - x0;
}
function wlBeam(hull, T) {
  return 2 * Math.max(...hull.stations.map(st => yAt(st, T)));
}

/* полная площадь наружной поверхности корпуса (для массы оболочки и лака) */
function shellArea(hull) {
  const S = hull.stations;
  let a = 0;
  for (let i = 0; i < S.length - 1; i++) {
    const dx = S[i + 1].x - S[i].x;
    const g0 = girth(S[i], hull.D + 1), g1 = girth(S[i + 1], hull.D + 1);
    a += (g0 + g1) / 2 * dx;
  }
  // транец (замкнутая корма): площадь первого шпангоута
  a += sectionAM(S[0], hull.D).a;
  return a;
}

/* объём корпуса до палубы (запас плавучести) */
function hullVolume(hull) { return hydrostatics(hull, hull.D).V; }

/* площадь наружной поверхности с центром тяжести (для массы оболочки)
 * и то же для палубы */
function shellProps(hull) {
  const S = hull.stations;
  let A = 0, xA = 0, zA = 0, Ad = 0, xAd = 0;
  for (let i = 0; i < S.length - 1; i++) {
    const dx = S[i + 1].x - S[i].x, xm = (S[i].x + S[i + 1].x) / 2;
    // полоса обшивки: по сегментам контура (оба борта)
    for (let k = 0; k < S[i].pts.length - 1; k++) {
      const a0 = S[i].pts[k], b0 = S[i].pts[k + 1];
      const g = Math.hypot(b0.y - a0.y, b0.z - a0.z) * 2; // оба борта
      const da = g * dx;
      A += da; xA += da * xm; zA += da * (a0.z + b0.z) / 2;
    }
    // палуба (полная ширина)
    const yd0 = S[i].pts[S[i].pts.length - 1].y, yd1 = S[i + 1].pts[S[i + 1].pts.length - 1].y;
    const dd = (yd0 + yd1) * dx;
    Ad += dd; xAd += dd * xm;
  }
  // транец
  const at = sectionAM(S[0], hull.D);
  A += at.a; zA += at.a * (at.a > 1e-12 ? at.mz / at.a : 0);
  return {
    A, x: A > 1e-12 ? xA / A : 0, z: A > 1e-12 ? zA / A : 0,
    Adeck: Ad, xdeck: Ad > 1e-12 ? xAd / Ad : 0,
  };
}

/* ---------- посадка: осадка из равновесия, дифферент из моментов ----------
 * mass — кг, xg/zg — ЦТ по длине и высоте, м. */
function equilibrium(hull, mass, xg, zg) {
  const Vneed = mass / RHO_W;
  let lo = keelMin(hull) + 1e-4, hi = hull.D;
  if (hydrostatics(hull, hi).V < Vneed) return { floats: false };
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    (hydrostatics(hull, mid).V < Vneed) ? lo = mid : hi = mid;
  }
  const T = (lo + hi) / 2;
  const h = hydrostatics(hull, T);
  const GMt = h.KMt - zg;
  const GMl = h.zb + h.BMl - zg;
  // дифферент: tg ψ = (xg − xb)/GM_L; осадки на перпендикулярах
  const tanPsi = GMl > 1e-9 ? (xg - h.xb) / GMl : 0;
  const Tf = T + (hull.L - h.xf) * tanPsi;   // нос (x = L)
  const Ta = T - h.xf * tanPsi;              // корма (x = 0)
  return {
    floats: true, T, h, GMt, GMl, tanPsi,
    psiDeg: Math.atan(tanPsi) * 180 / Math.PI,
    Tf, Ta, freeboard: hull.D - Math.max(Tf, Ta, T),
  };
}

/* ---------- диаграмма статической остойчивости (упрощённо, стенка борта) ----
 * Плечо l(θ) наклонением сечений (клиппинг контуров), объём удерживается
 * бисекцией уровня воды. Возвращает [{deg, gz}] до угла заливания палубы. */
function gzCurve(hull, mass, zg, maxDeg) {
  const V0 = mass / RHO_W;
  const out = [];
  for (let deg = 0; deg <= (maxDeg || 60); deg += 5) {
    const th = deg * Math.PI / 180;
    // уровень воды d в наклонённой системе: подбираем по объёму
    let lo = -hull.D, hi = hull.D * 1.5, res = null;
    for (let i = 0; i < 32; i++) {
      const d = (lo + hi) / 2;
      res = heeledVolume(hull, th, d);
      (res.V < V0) ? lo = d : hi = d;
    }
    // плечо = горизонтальное расстояние между ЦВ и ЦТ в мировой системе;
    // ЦТ (0, zg) после поворота контура уходит в y = −zg·sinθ
    const yb = res.My / Math.max(1e-12, res.V);
    const gz = -(yb + zg * Math.sin(th));
    out.push({ deg, gz, deckEdge: res.deckEdge });
  }
  return out;
}
/* объём и моменты погруженной части при крене θ и уровне воды d (мировая Z) */
function heeledVolume(hull, th, d) {
  const S = hull.stations;
  let V = 0, My = 0, Mz = 0, deckEdge = false;
  const per = S.map(st => {
    // полный контур (оба борта), повёрнутый на θ
    const poly = [];
    for (let k = 0; k < st.pts.length; k++) poly.push([st.pts[k].y, st.pts[k].z]);
    for (let k = st.pts.length - 1; k >= 0; k--) poly.push([-st.pts[k].y, st.pts[k].z]);
    const rot = poly.map(([y, z]) => [y * Math.cos(th) - z * Math.sin(th), y * Math.sin(th) + z * Math.cos(th)]);
    // отсечь Z ≤ d
    const clip = [];
    for (let i = 0; i < rot.length; i++) {
      const A = rot[i], B2 = rot[(i + 1) % rot.length];
      const da = A[1] - d, db = B2[1] - d;
      if (da <= 0) clip.push(A);
      if ((da < 0) !== (db < 0)) {
        const t = da / (da - db);
        clip.push([A[0] + (B2[0] - A[0]) * t, A[1] + (B2[1] - A[1]) * t]);
      }
    }
    // палуба вошла в воду?
    const deckPt = rot[st.pts.length - 1];
    if (deckPt[1] < d) deckEdge = true;
    let a = 0, cy = 0, cz = 0;
    for (let i = 0; i < clip.length; i++) {
      const [x0, y0] = clip[i], [x1, y1] = clip[(i + 1) % clip.length];
      const cr = x0 * y1 - x1 * y0;
      a += cr; cy += (x0 + x1) * cr; cz += (y0 + y1) * cr;
    }
    a /= 2;
    if (Math.abs(a) < 1e-12) return { a: 0, cy: 0, cz: 0 };
    return { a: Math.abs(a), cy: cy / (6 * a), cz: cz / (6 * a) };
  });
  for (let i = 0; i < S.length - 1; i++) {
    const dx = S[i + 1].x - S[i].x;
    V += (per[i].a + per[i + 1].a) / 2 * dx;
    My += (per[i].a * per[i].cy + per[i + 1].a * per[i + 1].cy) / 2 * dx;
    Mz += (per[i].a * per[i].cz + per[i + 1].a * per[i + 1].cz) / 2 * dx;
  }
  return { V, My, Mz, deckEdge };
}

/* ---------- сопротивление и прогноз скорости ----------
 * R = (C_F·(1+k) + C_A)·½ρSV² + C_R(Fn)·½ρSV²; C_F по ИТТК-57.
 * Винт: T = K_T·ρ·n²·D⁴, K_T = Kt0·(1 − J/J0) — линейная аппроксимация
 * кривой действия малого гребного винта. */
function speedPredict(hull, eq, prop) {
  // prop: {D (м), pitch (м), rpm (1/с при нагрузке ~70% холостых), count}
  const S = eq.h.Swet, Lwl = eq.h.Lwl;
  const nu = 1.0e-6, k = 0.10, Ca = 0.0004;
  const crCurve = curve(hull.proto.crFn || [[0.1, 0.001], [0.5, 0.01]]);
  const n = prop.rpm, Dp = prop.D, J0 = 1.05 * prop.pitch / prop.D, Kt0 = 0.32;
  let lo = 0.01, hi = 5;
  const thrust = V => {
    const J = V / Math.max(1e-9, n * Dp);
    return prop.count * Kt0 * Math.max(0, 1 - J / J0) * RHO_W * n * n * Math.pow(Dp, 4) * (1 - 0.05);
  };
  const resist = V => {
    const Re = Math.max(1e4, V * Lwl / nu);
    const Cf = 0.075 / Math.pow(Math.log10(Re) - 2, 2);
    const Fn = V / Math.sqrt(9.81 * Lwl);
    const Cr = crCurve(Fn);
    return (Cf * (1 + k) + Ca + Cr) * 0.5 * RHO_W * S * V * V;
  };
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    (thrust(mid) > resist(mid)) ? lo = mid : hi = mid;
  }
  const V = (lo + hi) / 2;
  const Re = V * Lwl / nu, Fn = V / Math.sqrt(9.81 * Lwl);
  return {
    V, Fn, Re,
    Cf: 0.075 / Math.pow(Math.log10(Math.max(1e4, Re)) - 2, 2),
    Cr: crCurve(Fn), R: resist(V), Tprop: thrust(V), k, Ca,
  };
}

/* ---------- экспорт ---------- */
if (typeof module !== 'undefined') {
  module.exports = {
    RHO_W, PROTOS, makeHull, hydrostatics, equilibrium, gzCurve,
    shellArea, shellProps, hullVolume, speedPredict, yAt, sectionAM, curve,
  };
}
