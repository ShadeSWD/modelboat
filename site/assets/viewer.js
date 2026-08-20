/* Трёхмерный просмотрщик сборки: WebGL без внешних библиотек.
 * viewer3d(canvas) → {setParts([{tris, color, name}]), redraw()}.
 * Управление: перетаскивание — поворот, колесо/щипок — масштаб,
 * двойной щелчок — сброс. Плоская заливка по нормалям граней, две
 * стороны освещены (внутренность открытого корпуса видна). */
'use strict';

function viewer3d(canvas) {
  const gl = canvas.getContext('webgl', { antialias: true });
  if (!gl) { canvas.replaceWith('WebGL недоступен в этом браузере'); return null; }

  const vs = `attribute vec3 aP; attribute vec3 aN; attribute vec3 aC;
    uniform mat4 uM; uniform mat4 uR;
    varying vec3 vN; varying vec3 vC;
    void main(){ gl_Position = uM * vec4(aP,1.0); vN = mat3(uR) * aN; vC = aC; }`;
  const fs = `precision mediump float;
    varying vec3 vN; varying vec3 vC;
    uniform float uPickMode; uniform vec3 uPickColor;
    void main(){
      if (uPickMode > 0.5) { gl_FragColor = vec4(uPickColor, 1.0); return; }
      vec3 n = normalize(vN);
      float d = abs(dot(n, normalize(vec3(0.45, 0.6, 0.8))));
      float d2 = abs(dot(n, normalize(vec3(-0.6, -0.2, 0.4))));
      float l = 0.35 + 0.55*d + 0.18*d2;
      gl_FragColor = vec4(vC * l, 1.0);
    }`;
  function sh(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    return s;
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(prog); gl.useProgram(prog);
  const aP = gl.getAttribLocation(prog, 'aP'), aN = gl.getAttribLocation(prog, 'aN'),
    aC = gl.getAttribLocation(prog, 'aC');
  const uM = gl.getUniformLocation(prog, 'uM'), uR = gl.getUniformLocation(prog, 'uR');
  const uPickMode = gl.getUniformLocation(prog, 'uPickMode'),
    uPickColor = gl.getUniformLocation(prog, 'uPickColor');
  gl.enable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE); // открытая палуба: видны обе стороны стенки

  let buf = null, nVerts = 0, center = [0, 0, 0], radius = 100;
  let yaw = 2.7, pitch = -0.7, zoom = 1.5;
  let ranges = [], pickCb = null;

  function setParts(parts) {
    let n = 0;
    for (const p of parts) n += p.tris.length * 3;
    const arr = new Float32Array(n * 9);
    let o = 0;
    let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    ranges = [];
    for (const part of parts) {
      ranges.push({ start: o / 9, count: part.tris.length * 3, name: part.name });
      const c = part.color || [0.5, 0.5, 0.5];
      for (const t of part.tris) {
        const [A, B, C] = t;
        let nx = (B[1] - A[1]) * (C[2] - A[2]) - (B[2] - A[2]) * (C[1] - A[1]);
        let ny = (B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]);
        let nz = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l; ny /= l; nz /= l;
        for (const P of t) {
          arr[o++] = P[0]; arr[o++] = P[1]; arr[o++] = P[2];
          arr[o++] = nx; arr[o++] = ny; arr[o++] = nz;
          arr[o++] = c[0]; arr[o++] = c[1]; arr[o++] = c[2];
          for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], P[i]); mx[i] = Math.max(mx[i], P[i]); }
        }
      }
    }
    center = [0, 1, 2].map(i => (mn[i] + mx[i]) / 2);
    radius = Math.max(1, Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) / 2);
    if (!buf) buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
    nVerts = n;
    redraw();
  }

  function mat() {
    // модель: перенос в центр, поворот yaw (вокруг Z-вверх оси модели = ось Y экрана?)
    // сцена: X модели вправо, Z модели вверх; поворот yaw вокруг Z, pitch вокруг экрана-X
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    // R = Rx(pitch)·Rz(yaw), затем оси модели (x,y,z) → экранные (x, z-вверх → y)
    const R = [
      cy, sy * cp, sy * sp,
      -sy, cy * cp, cy * sp,
      0, -sp, cp,
    ]; // столбцы: образы ортов модели в осях (право, вверх, к камере)
    const d = radius * 2.6 / zoom;
    const asp = canvas.width / canvas.height;
    const f = 2.2;
    // перспектива + вид
    const M = new Float32Array(16), Rm = new Float32Array(16);
    // model→eye: e = R·(p−center); eye смотрит вдоль −z с расстояния d
    // проекция: x' = f/asp·x/(d−z…) — соберём вручную построчно
    // Здесь достаточно фиксированной перспективной матрицы:
    const near = d * 0.1, far = d * 4;
    const px = f / asp, py = f;
    // итог: clip = P · T(−[0,0,d]) · R · T(−center)
    // развёрнуто (столбцовый порядок WebGL):
    const r = R;
    const tx = -(r[0] * center[0] + r[3] * center[1] + r[6] * center[2]);
    const ty = -(r[1] * center[0] + r[4] * center[1] + r[7] * center[2]);
    const tz = -(r[2] * center[0] + r[5] * center[1] + r[8] * center[2]) - d;
    const A = (far + near) / (near - far), Bq = 2 * far * near / (near - far);
    M.set([
      px * r[0], py * r[1], A * r[2], -r[2],
      px * r[3], py * r[4], A * r[5], -r[5],
      px * r[6], py * r[7], A * r[8], -r[8],
      px * tx, py * ty, A * tz + Bq, -tz,
    ]);
    Rm.set([r[0], r[1], r[2], 0, r[3], r[4], r[5], 0, r[6], r[7], r[8], 0, 0, 0, 0, 1]);
    return { M, Rm };
  }

  function redraw() {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth * dpr, h = canvas.clientHeight * dpr;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.97, 0.985, 0.99, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!nVerts) return;
    const { M, Rm } = mat();
    gl.uniformMatrix4fv(uM, false, M);
    gl.uniformMatrix4fv(uR, false, Rm);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(aP); gl.vertexAttribPointer(aP, 3, gl.FLOAT, false, 36, 0);
    gl.enableVertexAttribArray(aN); gl.vertexAttribPointer(aN, 3, gl.FLOAT, false, 36, 12);
    gl.enableVertexAttribArray(aC); gl.vertexAttribPointer(aC, 3, gl.FLOAT, false, 36, 24);
    gl.uniform1f(uPickMode, 0);
    gl.drawArrays(gl.TRIANGLES, 0, nVerts);
  }

  /* определение детали под курсором: каждая группа рисуется своим
   * плоским цветом-номером, пиксель читается обратно */
  function pickAt(clientX, clientY) {
    if (!nVerts) return -1;
    const rect = canvas.getBoundingClientRect();
    const dpr = canvas.width / rect.width;
    const px = Math.round((clientX - rect.left) * dpr);
    const py = Math.round((rect.bottom - clientY) * dpr);
    gl.clearColor(1, 1, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniform1f(uPickMode, 1);
    for (let i = 0; i < ranges.length; i++) {
      gl.uniform3f(uPickColor, ((i + 1) & 255) / 255, (((i + 1) >> 8) & 255) / 255, 0);
      gl.drawArrays(gl.TRIANGLES, ranges[i].start, ranges[i].count);
    }
    const pix = new Uint8Array(4);
    gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pix);
    gl.uniform1f(uPickMode, 0);
    redraw();
    const idx = pix[0] + pix[1] * 256 - 1;
    return (idx >= 0 && idx < ranges.length) ? idx : -1;
  }

  // управление
  let drag = null, pinch = null, moved = 0;
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    if (drag && !pinch) pinch = { id2: e.pointerId, x: e.clientX, y: e.clientY };
    else { drag = { id: e.pointerId, x: e.clientX, y: e.clientY }; moved = 0; }
    // preventDefault здесь нельзя: он подавляет синтез события click,
    // на котором работает определение детали; прокрутку держит touch-action
  });
  canvas.addEventListener('pointermove', e => {
    if (pinch && (e.pointerId === pinch.id2 || (drag && e.pointerId === drag.id))) {
      if (e.pointerId === pinch.id2) { pinch.x = e.clientX; pinch.y = e.clientY; }
      else { drag.x = e.clientX; drag.y = e.clientY; }
      const dist = Math.hypot(pinch.x - drag.x, pinch.y - drag.y);
      if (pinch.d0) zoom = Math.min(12, Math.max(0.3, zoom * dist / pinch.d0));
      pinch.d0 = dist;
      redraw();
      return;
    }
    if (drag && e.pointerId === drag.id) {
      moved += Math.hypot(e.clientX - drag.x, e.clientY - drag.y);
      yaw += (e.clientX - drag.x) * 0.008;
      pitch = Math.min(1.5, Math.max(-1.5, pitch + (e.clientY - drag.y) * 0.008));
      drag.x = e.clientX; drag.y = e.clientY;
      redraw();
    }
  });
  const up = e => {
    if (pinch && e.pointerId === pinch.id2) pinch = null;
    else if (drag && e.pointerId === drag.id) {
      drag = null;
      if (pinch) { drag = { id: pinch.id2, x: pinch.x, y: pinch.y }; pinch = null; }
    }
  };
  // короткий клик без перетаскивания — определить деталь
  canvas.addEventListener('click', e => {
    if (moved < 6 && pickCb) {
      const idx = pickAt(e.clientX, e.clientY);
      pickCb(idx >= 0 ? ranges[idx].name : null);
    }
  });
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', e => {
    zoom = Math.min(12, Math.max(0.3, zoom * (e.deltaY < 0 ? 1.12 : 0.89)));
    redraw();
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('dblclick', () => { yaw = 2.7; pitch = -0.7; zoom = 1.5; redraw(); });
  window.addEventListener('resize', redraw);
  const setView = (y, p, z) => { yaw = y; pitch = p; if (z) zoom = z; redraw(); };
  return { setParts, redraw, setView, pick: pickAt, onPick: cb => { pickCb = cb; } };
}
