/* panel.js — браузерный пульт модели судна (Web Bluetooth).
 *
 * Подключается к лодке по BLE UART: сервис Nordic UART (набор «Микро»,
 * ESP32-C3) или FFE0/FFE1 (набор «Классика», HM-10). Джойстик — canvas под
 * палец; команды текстового протокола (см. страницу control) уходят не чаще
 * 10 Гц + heartbeat 0,3 с; телеметрия «V<мВ>» показывается индикатором.
 * Работает только по HTTPS в браузерах с Web Bluetooth (Chrome/Edge).
 */
'use strict';
(function () {
  /* ---------- UUID сервисов ---------- */
  const NUS_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
  const NUS_RX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // запись: пульт → лодка
  const NUS_TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // уведомления: лодка → пульт
  const HM10_SERVICE = 0xffe0;
  const HM10_CHAR = 0xffe1;                 // и запись, и уведомления

  const SEND_MS = 100;                      // не чаще 10 Гц
  const HEARTBEAT_MS = 300;                 // повтор той же команды

  const $ = (id) => document.getElementById(id);
  const ui = {
    connect: $('btn-connect'), disconnect: $('btn-disconnect'),
    stop: $('btn-stop'), conn: $('st-conn'), note: $('st-note'),
    volt: $('st-volt'), cmd: $('st-cmd'),
    lim: $('powlim'), limOut: $('powlim-out'), joy: $('joy'),
  };

  /* ---------- состояние ---------- */
  let device = null, writeChar = null;
  let connected = false, busy = false;
  let lastCmd = '', lastSentAt = 0;
  let jx = 0, jy = 0;                       // джойстик, каждый в [−1, 1]
  const enc = new TextEncoder();

  const mode = () =>
    (document.querySelector('input[name=mode]:checked') || {}).value || 'twin';
  const limit = () => (+ui.lim.value) / 100;
  const clamp100 = (v) => Math.max(-100, Math.min(100, Math.round(v)));

  /* ---------- поддержка браузером ---------- */
  if (!('bluetooth' in navigator)) {
    ui.connect.disabled = true;
    ui.note.innerHTML = 'В этом браузере нет Web Bluetooth. Возьмите Chrome ' +
      'или Edge (Android, Windows, Linux, macOS); на iPhone — браузер Bluefy. ' +
      'Джойстиком можно подвигать и так — команды видны в строке «Команда».';
  }

  /* ---------- подключение ---------- */
  function setConn(on, msg) {
    connected = on;
    ui.conn.textContent = on ? 'связь есть' : 'нет связи';
    ui.conn.className = 'badge ' + (on ? 'ok' : 'bad');
    ui.connect.style.display = on ? 'none' : '';
    ui.disconnect.style.display = on ? '' : 'none';
    if (msg) ui.note.textContent = msg;
    if (!on) { ui.volt.textContent = '—'; writeChar = null; }
  }

  async function connect() {
    try {
      ui.note.textContent = 'Выберите устройство в списке…';
      device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [NUS_SERVICE] }, { services: [HM10_SERVICE] }],
        optionalServices: [NUS_SERVICE, HM10_SERVICE],
      });
      device.addEventListener('gattserverdisconnected', () =>
        setConn(false, 'Связь с лодкой потеряна. Прошивка остановит моторы ' +
          'сама (failsafe 1 с). Нажмите «Подключиться» ещё раз.'));
      ui.note.textContent = 'Подключение…';
      const gatt = await device.gatt.connect();

      let notifyChar = null;
      try {                                  // сначала пробуем NUS («Микро»)
        const svc = await gatt.getPrimaryService(NUS_SERVICE);
        writeChar = await svc.getCharacteristic(NUS_RX);
        notifyChar = await svc.getCharacteristic(NUS_TX);
      } catch (e) {                          // иначе — FFE0 (HM-10)
        const svc = await gatt.getPrimaryService(HM10_SERVICE);
        writeChar = await svc.getCharacteristic(HM10_CHAR);
        notifyChar = writeChar;
      }
      try {
        await notifyChar.startNotifications();
        notifyChar.addEventListener('characteristicvaluechanged', onNotify);
      } catch (e) { /* телеметрии может и не быть — пульт работает без неё */ }

      setConn(true, 'Подключено: ' + (device.name || 'без имени') +
        '. Джойстик активен. Первые выходы — с ограничением мощности.');
    } catch (e) {
      setConn(false, 'Не подключилось: ' + (e && e.message ? e.message : e) +
        '. Проверьте, что лодка включена, а страница открыта по HTTPS.');
    }
  }

  /* ---------- телеметрия ---------- */
  let rxBuf = '';
  function onNotify(ev) {
    rxBuf += new TextDecoder().decode(ev.target.value);
    let i;
    while ((i = rxBuf.indexOf('\n')) >= 0) {
      const line = rxBuf.slice(0, i).trim();
      rxBuf = rxBuf.slice(i + 1);
      if (line[0] === 'V') {
        const mv = parseInt(line.slice(1), 10);
        if (!isFinite(mv)) continue;
        const cells = mv > 5500 ? 2 : 1;    // 2S у «Классики», 1S у «Микро»
        const low = mv < cells * 3400;
        ui.volt.textContent = (mv / 1000).toFixed(2) + ' В' +
          (cells === 2 ? ' (2S)' : '') + (low ? ' — разряжена!' : '');
        ui.volt.style.color = low ? '#b3382e' : '';
      }
    }
    if (rxBuf.length > 200) rxBuf = '';     // мусор без переводов строки
  }

  /* ---------- отправка ---------- */
  async function sendRaw(s) {
    if (!writeChar || busy) return;
    busy = true;
    try {
      const data = enc.encode(s);
      if (writeChar.properties && writeChar.properties.writeWithoutResponse) {
        await writeChar.writeValueWithoutResponse(data);
      } else {
        await writeChar.writeValue(data);
      }
    } catch (e) { /* потерянный пакет не страшен: следующий через 100 мс */ }
    busy = false;
  }

  function buildCmd() {
    const t = clamp100(-jy * 100 * limit());     // вверх = вперёд
    const s = clamp100(jx * 100);                // вправо = руль вправо
    if (mode() === 'twin') {
      const l = clamp100((-jy * 100 + jx * 100) * limit());
      const r = clamp100((-jy * 100 - jx * 100) * limit());
      return 'T' + l + ',' + r + '\n';
    }
    return 'M' + t + ',' + s + '\n';
  }

  setInterval(() => {
    const cmd = buildCmd();
    ui.cmd.textContent = cmd.trim();
    if (!connected) return;
    const now = Date.now();
    if (cmd !== lastCmd || now - lastSentAt >= HEARTBEAT_MS) {
      lastCmd = cmd; lastSentAt = now;
      sendRaw(cmd);
    }
  }, SEND_MS);

  function stopAll() {
    jx = 0; jy = 0;
    drawJoy();
    lastCmd = 'S\n'; lastSentAt = Date.now();
    ui.cmd.textContent = 'S';
    if (connected) sendRaw('S\n');
  }

  ui.connect.addEventListener('click', connect);
  ui.disconnect.addEventListener('click', () => {
    stopAll();
    if (device && device.gatt && device.gatt.connected) device.gatt.disconnect();
    setConn(false, 'Отключено. Лодку можно выключать.');
  });
  ui.stop.addEventListener('click', stopAll);
  ui.lim.addEventListener('input', () => {
    ui.limOut.textContent = ui.lim.value + ' %';
  });

  /* ---------- джойстик ---------- */
  const cv = ui.joy;
  const ctx = cv.getContext('2d');
  let W = 0;                                 // сторона квадрата в CSS-пикселях

  function fitJoy() {
    const css = cv.getBoundingClientRect().width || 320;
    const dpr = window.devicePixelRatio || 1;
    W = css;
    cv.width = Math.round(css * dpr);
    cv.height = Math.round(css * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawJoy();
  }

  function drawJoy() {
    const c = W / 2, R = W * 0.42, r = W * 0.13;
    ctx.clearRect(0, 0, W, W);
    // рабочее поле
    ctx.beginPath(); ctx.arc(c, c, R, 0, 7);
    ctx.fillStyle = '#f4f6fb'; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = '#c9d6f2'; ctx.stroke();
    // оси
    ctx.strokeStyle = '#d5d9e2'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(c - R, c); ctx.lineTo(c + R, c);
    ctx.moveTo(c, c - R); ctx.lineTo(c, c + R);
    ctx.stroke();
    // подписи
    ctx.fillStyle = '#8a8a93';
    ctx.font = (W * 0.038) + 'px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('вперёд', c, c - R + W * 0.055);
    ctx.fillText('назад', c, c + R - W * 0.028);
    ctx.textAlign = 'left';
    ctx.fillText('лево', c - R + W * 0.02, c - W * 0.015);
    ctx.textAlign = 'right';
    ctx.fillText('право', c + R - W * 0.02, c - W * 0.015);
    // ручка
    const x = c + jx * (R - r), y = c + jy * (R - r);
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7);
    ctx.fillStyle = '#2b4fa0'; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke();
  }

  function moveJoy(ev) {
    const b = cv.getBoundingClientRect();
    const c = W / 2, R = W * 0.42, r = W * 0.13;
    let dx = (ev.clientX - b.left - c) / (R - r);
    let dy = (ev.clientY - b.top - c) / (R - r);
    const d = Math.hypot(dx, dy);
    if (d > 1) { dx /= d; dy /= d; }         // не выпускаем за круг
    jx = dx; jy = dy;
    drawJoy();
  }

  let tracking = false;
  cv.addEventListener('pointerdown', (ev) => {
    tracking = true;
    cv.setPointerCapture(ev.pointerId);
    moveJoy(ev);
  });
  cv.addEventListener('pointermove', (ev) => { if (tracking) moveJoy(ev); });
  const release = () => {
    tracking = false;
    jx = 0; jy = 0;                          // отпустили — газ в ноль
    drawJoy();
  };
  cv.addEventListener('pointerup', release);
  cv.addEventListener('pointercancel', release);

  window.addEventListener('resize', fitJoy);
  fitJoy();
})();
