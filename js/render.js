/* Sternenkompass – js/render.js
 *
 * Sternkarte mit perspektivischer Projektion (FOV 20–100 Grad, Default 60).
 * Sterne: WebGL-Points (ein Draw-Call, pro Frame aendert sich nur die
 * View-Matrix); Fallback auf Canvas-2D, falls WebGL fehlt. Linien, Labels,
 * Horizont, Gitter, Sonne/Mond/Planeten auf einem 2D-Overlay-Canvas.
 *
 * Koordinaten: Sternpositionen sind Einheitsvektoren im aequatorialen System
 * (Aequinoktium des Datums, Praezession wendet app.js einmalig beim Laden an).
 * app.js liefert pro Frame die Basis des Horizontsystems { N, E, U } als
 * Vektoren im Aequatorialsystem (abhaengig von Sternzeit und Breite) sowie die
 * Blickrichtung { azDeg, altDeg, rollDeg, fovDeg }. Azimut 0 = Nord, 90 = Ost.
 */

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

// ---------------------------------------------------------------------------
// Vektor-Helfer
// ---------------------------------------------------------------------------

function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function lincomb(a, fa, b, fb, c, fc) {
  return [
    a[0] * fa + b[0] * fb + (c ? c[0] * fc : 0),
    a[1] * fa + b[1] * fb + (c ? c[1] * fc : 0),
    a[2] * fa + b[2] * fb + (c ? c[2] * fc : 0),
  ];
}

// RA/Dec (Grad) -> aequatorialer Einheitsvektor
export function raDecToVec(raDeg, decDeg) {
  const cd = Math.cos(decDeg * D2R);
  return [
    cd * Math.cos(raDeg * D2R),
    cd * Math.sin(raDeg * D2R),
    Math.sin(decDeg * D2R),
  ];
}

// B-V-Farbindex -> RGB [0..1]. Naeherung ueber effektive Temperatur
// (Ballesteros) und einfache Schwarzkoerper-Anpassung, fuer Sterndarstellung
// voellig ausreichend.
export function bvToRgb(bv) {
  const b = Math.max(-0.4, Math.min(2.0, Number.isFinite(bv) ? bv : 0.5));
  let r, g, bl;
  if (b < 0.0) { r = 0.67 + 0.6 * (b + 0.4) / 0.4; g = 0.78 + 0.4 * (b + 0.4) / 0.4; bl = 1.0; }
  else if (b < 0.4) { r = 0.85 + 0.15 * b / 0.4; g = 0.90 + 0.10 * b / 0.4; bl = 1.0; }
  else if (b < 0.8) { const t = (b - 0.4) / 0.4; r = 1.0; g = 1.0 - 0.10 * t; bl = 1.0 - 0.25 * t; }
  else if (b < 1.4) { const t = (b - 0.8) / 0.6; r = 1.0; g = 0.90 - 0.16 * t; bl = 0.75 - 0.32 * t; }
  else { const t = (b - 1.4) / 0.6; r = 1.0; g = 0.74 - 0.16 * t; bl = 0.43 - 0.18 * t; }
  return [r, g, bl];
}

// ---------------------------------------------------------------------------
// Shader (WebGL-Pfad)
// ---------------------------------------------------------------------------

const VS = `
attribute vec3 aPos;
attribute float aMag;
attribute vec3 aCol;
uniform mat3 uView;      // Zeilen: right, up, forward (aequatorial)
uniform vec2 uProj;      // 2*fpx/breite, 2*fpx/hoehe (Device-Pixel)
uniform float uSize;     // Groessenskala (Device-Pixel)
varying vec3 vCol;
varying float vAlpha;
void main() {
  vec3 c = uView * aPos;
  gl_Position = vec4(c.xy * uProj, 0.0, c.z);
  float s = uSize * exp(-0.30 * aMag);
  gl_PointSize = clamp(s, 2.0, 20.0);
  vCol = aCol;
  vAlpha = clamp(1.3 - 0.13 * aMag, 0.3, 1.0);
}`;

const FS = `
precision mediump float;
varying vec3 vCol;
varying float vAlpha;
void main() {
  vec2 d = gl_PointCoord - vec2(0.5);
  float r = length(d) * 2.0;
  float a = smoothstep(1.0, 0.35, r) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vCol * a, a);
}`;

function compileProgram(gl, vsSrc, fsSrc) {
  function sh(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error("Shader: " + gl.getShaderInfoLog(s));
    }
    return s;
  }
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error("Program: " + gl.getProgramInfoLog(p));
  }
  return p;
}

// ---------------------------------------------------------------------------
// Planetenfarben (Overlay-Scheiben)
// ---------------------------------------------------------------------------

const PLANETEN_FARBEN = {
  merkur: "#c8b8a2",
  venus: "#f3e6c0",
  mars: "#e0714b",
  jupiter: "#e8cfa2",
  saturn: "#e7d9a0",
  uranus: "#a8dde2",
  neptun: "#7d9cf0",
};

const HIMMELSRICHTUNGEN = [
  { az: 0, txt: "N", gross: true },
  { az: 45, txt: "NO", gross: false },
  { az: 90, txt: "O", gross: true },
  { az: 135, txt: "SO", gross: false },
  { az: 180, txt: "S", gross: true },
  { az: 225, txt: "SW", gross: false },
  { az: 270, txt: "W", gross: true },
  { az: 315, txt: "NW", gross: false },
];

// ---------------------------------------------------------------------------
// StarRenderer
// ---------------------------------------------------------------------------

export class StarRenderer {
  constructor(starCanvas, overlayCanvas) {
    this.starCanvas = starCanvas;
    this.overlayCanvas = overlayCanvas;
    this.ctx = overlayCanvas.getContext("2d");
    this.dpr = 1;
    this.w = 0;   // CSS-Pixel
    this.h = 0;
    this.cam = null;        // { right, up, fwd, fpx, cx, cy }
    this.stars = null;      // { vecs: Float32Array, mags, cols, count, meta[] }
    this.cons = null;       // Sternbilder mit Indexlisten
    this.starCtx2d = null;  // 2D-Fallback

    this.gl = null;
    this._glInit();
    if (!this.gl) {
      this.starCtx2d = starCanvas.getContext("2d");
    }
    // iOS wirft den WebGL-Kontext bei App-Wechsel/Speicherdruck gern weg.
    // Ohne preventDefault kaeme er nie zurueck (Sternfeld bliebe schwarz).
    starCanvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.gl = null;
    });
    starCanvas.addEventListener("webglcontextrestored", () => {
      this._glInit();
      if (this.gl && this._starsRaw) {
        const { vecs, mags, bvs, meta } = this._starsRaw;
        this.setStars(vecs, mags, bvs, meta);
      }
    });
  }

  _glInit() {
    try {
      // preserveDrawingBuffer kostet auf iOS eine Framebuffer-Kopie pro Frame;
      // nur fuer Headless-Screenshots (Testhook ?autostart=) aktivieren.
      const testMode = typeof location !== "undefined" &&
        new URLSearchParams(location.search).has("autostart");
      const gl = this.starCanvas.getContext("webgl", {
        antialias: false,
        alpha: false,
        depth: false,
        preserveDrawingBuffer: testMode,
      });
      if (gl && !gl.isContextLost()) {
        this.gl = gl;
        this.prog = compileProgram(gl, VS, FS);
        this.loc = {
          aPos: gl.getAttribLocation(this.prog, "aPos"),
          aMag: gl.getAttribLocation(this.prog, "aMag"),
          aCol: gl.getAttribLocation(this.prog, "aCol"),
          uView: gl.getUniformLocation(this.prog, "uView"),
          uProj: gl.getUniformLocation(this.prog, "uProj"),
          uSize: gl.getUniformLocation(this.prog, "uSize"),
        };
        this.bufPos = gl.createBuffer();
        this.bufMag = gl.createBuffer();
        this.bufCol = gl.createBuffer();
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE); // additiv auf dunklem Grund
      }
    } catch (e) {
      this.gl = null;
    }
  }

  get mode() { return this.gl ? "webgl" : "canvas2d"; }

  // Sterne einmalig setzen. meta: Array paralleler Objekte fuer Picking/Info.
  setStars(vecs, mags, bvs, meta) {
    this._starsRaw = { vecs, mags, bvs, meta }; // fuer Context-Restore
    const n = mags.length;
    const cols = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const [r, g, b] = bvToRgb(bvs[i]);
      cols[i * 3] = r; cols[i * 3 + 1] = g; cols[i * 3 + 2] = b;
    }
    this.stars = { vecs, mags, cols, count: n, meta };
    if (this.gl) {
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bufPos);
      gl.bufferData(gl.ARRAY_BUFFER, vecs, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bufMag);
      gl.bufferData(gl.ARRAY_BUFFER, mags, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bufCol);
      gl.bufferData(gl.ARRAY_BUFFER, cols, gl.STATIC_DRAW);
    }
  }

  // Sternbilder: [{ key, de, lat, lines: [[starIdx,...],...], centerVec }]
  setConstellations(cons) { this.cons = cons; }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.overlayCanvas.clientWidth || window.innerWidth;
    const h = this.overlayCanvas.clientHeight || window.innerHeight;
    if (w === this.w && h === this.h && dpr === this.dpr) return;
    this.dpr = dpr; this.w = w; this.h = h;
    for (const c of [this.starCanvas, this.overlayCanvas]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    if (this.gl) this.gl.viewport(0, 0, this.starCanvas.width, this.starCanvas.height);
  }

  // Kamera-Basis aus Blickrichtung + Horizontbasis (aequatoriale Vektoren).
  _updateCamera(view, frame) {
    const az = view.azDeg * D2R, alt = view.altDeg * D2R, roll = view.rollDeg * D2R;
    const { N, E, U } = frame;
    const ca = Math.cos(az), sa = Math.sin(az);
    const ch = Math.cos(alt), sh = Math.sin(alt);
    const fwd = lincomb(N, ch * ca, E, ch * sa, U, sh);
    const r0 = lincomb(E, ca, N, -sa);          // horizontal-rechts
    // Achtung: (N, E, U) ist als Kompass-Dreibein LINKShaendig (Azimut laeuft
    // von Nord nach Ost im Uhrzeigersinn), daher r0 x fwd fuer "Oben".
    const u0 = cross(r0, fwd);
    const cr = Math.cos(roll), sr = Math.sin(roll);
    const right = lincomb(r0, cr, u0, -sr);
    const up = lincomb(u0, cr, r0, sr);
    const fovClamped = Math.max(20, Math.min(100, view.fovDeg));
    const fpx = (this.h / 2) / Math.tan((fovClamped * D2R) / 2);
    this.cam = {
      right, up, fwd, fpx,
      cx: this.w / 2, cy: this.h / 2,
      U, fov: fovClamped,
    };
  }

  // Aequatorialen Einheitsvektor auf den Schirm projizieren (CSS-Pixel).
  // Rueckgabe { x, y, z } mit z = Vorwaertskomponente; z <= 0 heisst hinter
  // der Kamera (x/y dann unbrauchbar). null ohne Kamera.
  project(v) {
    const c = this.cam;
    if (!c) return null;
    const z = dot(v, c.fwd);
    if (z <= 1e-6) return { x: NaN, y: NaN, z };
    return {
      x: c.cx + (dot(v, c.right) / z) * c.fpx,
      y: c.cy - (dot(v, c.up) / z) * c.fpx,
      z,
    };
  }

  onScreen(p, pad = 0) {
    return p && p.z > 0 &&
      p.x >= -pad && p.x <= this.w + pad &&
      p.y >= -pad && p.y <= this.h + pad;
  }

  // Pixel pro Grad in Bildmitte (fuer Gesten und Groessen).
  pxPerDeg() { return this.cam ? this.cam.fpx * D2R : 12; }

  // ---------------------------------------------------------------------
  // Hauptzeichnung. scene:
  //   view {azDeg,altDeg,rollDeg,fovDeg}, frame {N,E,U},
  //   settings {linien, sternbildNamen, sternnamen, gitter},
  //   bodies [{key,name,type,v,mag,angRadiusDeg,moon:{illumFraction,isWaxing}}]
  // Rueckgabe: gezeichnete Koerper mit Schirmposition (fuer Picking).
  // ---------------------------------------------------------------------
  render(scene) {
    this.resize();
    this._sceneFrame = scene.frame;
    this._updateCamera(scene.view, scene.frame);
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    this._labels = [];

    this._drawStars();
    if (scene.settings.gitter) this._drawGrid();
    if (scene.settings.linien && this.cons) this._drawConstellationLines();
    this._dimBelowHorizon();
    this._drawHorizon();
    const drawnBodies = this._drawBodies(scene.bodies || []);
    if (scene.settings.sternbildNamen && this.cons) this._drawConstellationNames();
    if (scene.settings.sternnamen && this.stars) this._drawStarNames();
    return drawnBodies;
  }

  // --- Sterne ------------------------------------------------------------
  _drawStars() {
    if (!this.stars) return;
    const c = this.cam;
    const sizeScale = 9.0 * this.dpr * Math.pow(60 / c.fov, 0.6);
    if (this.gl) {
      const gl = this.gl;
      gl.clearColor(0.0196, 0.0314, 0.0627, 1); // #050810
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(this.prog);
      // Zeilenweise [right; up; fwd] -> column-major fuer uniformMatrix3fv
      const m = [
        c.right[0], c.up[0], c.fwd[0],
        c.right[1], c.up[1], c.fwd[1],
        c.right[2], c.up[2], c.fwd[2],
      ];
      gl.uniformMatrix3fv(this.loc.uView, false, m);
      const fpxDev = c.fpx * this.dpr;
      gl.uniform2f(this.loc.uProj, 2 * fpxDev / this.starCanvas.width, 2 * fpxDev / this.starCanvas.height);
      gl.uniform1f(this.loc.uSize, sizeScale);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bufPos);
      gl.enableVertexAttribArray(this.loc.aPos);
      gl.vertexAttribPointer(this.loc.aPos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bufMag);
      gl.enableVertexAttribArray(this.loc.aMag);
      gl.vertexAttribPointer(this.loc.aMag, 1, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bufCol);
      gl.enableVertexAttribArray(this.loc.aCol);
      gl.vertexAttribPointer(this.loc.aCol, 3, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.POINTS, 0, this.stars.count);
      return;
    }
    // 2D-Fallback (z. B. WebGL nicht verfuegbar)
    const g = this.starCtx2d;
    if (!g) return;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = "#050810";
    g.fillRect(0, 0, this.w, this.h);
    const { vecs, mags, cols, count } = this.stars;
    const v = [0, 0, 0];
    for (let i = 0; i < count; i++) {
      v[0] = vecs[i * 3]; v[1] = vecs[i * 3 + 1]; v[2] = vecs[i * 3 + 2];
      const p = this.project(v);
      if (!this.onScreen(p, 10)) continue;
      const r = Math.max(0.6, Math.min(7, (sizeScale / this.dpr) * Math.exp(-0.30 * mags[i]) * 0.5));
      const a = Math.max(0.25, Math.min(1, 1.25 - 0.14 * mags[i]));
      g.fillStyle = `rgba(${Math.round(cols[i * 3] * 255)},${Math.round(cols[i * 3 + 1] * 255)},${Math.round(cols[i * 3 + 2] * 255)},${a})`;
      g.beginPath();
      g.arc(p.x, p.y, r, 0, 6.2832);
      g.fill();
    }
  }

  // --- Alt/Az-Gitter -------------------------------------------------------
  _drawGrid() {
    const ctx = this.ctx;
    ctx.strokeStyle = "rgba(120, 140, 190, 0.22)";
    ctx.lineWidth = 1;
    // Gitterlinien direkt im Horizontsystem samplen
    const frame = this._sceneFrame;
    const toVec = (azD, altD) => {
      const ca = Math.cos(azD * D2R), sa = Math.sin(azD * D2R);
      const ch = Math.cos(altD * D2R), sh = Math.sin(altD * D2R);
      return lincomb(frame.N, ch * ca, frame.E, ch * sa, frame.U, sh);
    };
    // Azimutlinien alle 30 Grad
    for (let az = 0; az < 360; az += 30) {
      this._strokePolyline(Array.from({ length: 33 }, (_, i) => toVec(az, -80 + i * 5)));
    }
    // Hoehenkreise 30/60 und -30 Grad
    for (const alt of [-30, 30, 60]) {
      const pts = Array.from({ length: 73 }, (_, i) => toVec(i * 5, alt));
      this._strokePolyline(pts, true);
    }
  }

  _strokePolyline(vecs, closed = false) {
    const ctx = this.ctx;
    let started = false;
    let prev = null;
    ctx.beginPath();
    const jump = Math.max(this.w, this.h) * 0.75;
    const seq = closed ? vecs.concat([vecs[0]]) : vecs;
    for (const v of seq) {
      const p = this.project(v);
      const ok = p && p.z > 0.02;
      if (ok && prev && Math.abs(p.x - prev.x) < jump && Math.abs(p.y - prev.y) < jump && started) {
        ctx.lineTo(p.x, p.y);
      } else if (ok) {
        ctx.moveTo(p.x, p.y);
        started = true;
      } else {
        started = false;
      }
      prev = ok ? p : null;
    }
    ctx.stroke();
  }

  // --- Sternbildlinien -----------------------------------------------------
  _drawConstellationLines() {
    const ctx = this.ctx;
    ctx.strokeStyle = "rgba(122, 156, 220, 0.38)";
    ctx.lineWidth = 1;
    const { vecs } = this.stars;
    const v = [0, 0, 0];
    for (const con of this.cons) {
      for (const line of con.lineIdx) {
        ctx.beginPath();
        let started = false;
        for (const idx of line) {
          v[0] = vecs[idx * 3]; v[1] = vecs[idx * 3 + 1]; v[2] = vecs[idx * 3 + 2];
          const p = this.project(v);
          if (p && p.z > 0.02 && Math.abs(p.x - this.cam.cx) < this.w * 2 && Math.abs(p.y - this.cam.cy) < this.h * 2) {
            if (started) ctx.lineTo(p.x, p.y); else { ctx.moveTo(p.x, p.y); started = true; }
          } else {
            started = false;
          }
        }
        ctx.stroke();
      }
    }
  }

  _drawConstellationNames() {
    const ctx = this.ctx;
    ctx.font = `600 ${11}px -apple-system, sans-serif`;
    ctx.fillStyle = "rgba(150, 170, 215, 0.55)";
    ctx.textAlign = "center";
    for (const con of this.cons) {
      const p = this.project(con.centerVec);
      if (!this.onScreen(p, -20)) continue;
      const name = con.de.toUpperCase();
      const wpx = ctx.measureText(name).width;
      if (!this._placeLabel(p.x - wpx / 2, p.y - 6, wpx, 12)) continue;
      ctx.fillText(name, p.x, p.y);
    }
    ctx.textAlign = "left";
  }

  _drawStarNames() {
    const ctx = this.ctx;
    const { vecs, mags, meta, count } = this.stars;
    // Nur Eigennamen, nur helle Sterne; bei engem FOV mehr Namen.
    const magLimit = this.cam.fov < 40 ? 2.8 : 1.7;
    ctx.font = `12px -apple-system, sans-serif`;
    ctx.fillStyle = "rgba(233, 237, 248, 0.78)";
    const v = [0, 0, 0];
    for (let i = 0; i < count; i++) {
      if (mags[i] > magLimit) continue;
      const name = meta[i].name;
      if (!name) continue;
      v[0] = vecs[i * 3]; v[1] = vecs[i * 3 + 1]; v[2] = vecs[i * 3 + 2];
      const p = this.project(v);
      if (!this.onScreen(p, 0)) continue;
      const wpx = ctx.measureText(name).width;
      if (!this._placeLabel(p.x + 7, p.y + 3, wpx, 13)) continue;
      ctx.fillText(name, p.x + 7, p.y + 13);
    }
  }

  // --- Horizont ------------------------------------------------------------
  // Der Horizont (Grosskreis Hoehe 0) projiziert perspektivisch auf eine
  // Gerade a*x' + b*y' + c = 0 in Kamerakoordinaten. Die Bodenseite wird als
  // Halbebene abgedunkelt (durchscheinend, Sterne bleiben schwach sichtbar).
  _horizonHalfplane() {
    const c = this.cam;
    // d(px,py) . U  mit d = right*x' + up*y' + fwd, x' = (px-cx)/fpx, y' = (cy-py)/fpx
    const a = dot(c.right, c.U) / c.fpx;
    const b = -dot(c.up, c.U) / c.fpx;
    const k = dot(c.fwd, c.U) - a * c.cx - b * c.cy;
    // altSign(px,py) = a*px + b*py + k  (>0 ueber dem Horizont)
    return { a, b, k };
  }

  _dimBelowHorizon() {
    const { a, b, k } = this._horizonHalfplane();
    const corners = [[0, 0], [this.w, 0], [this.w, this.h], [0, this.h]];
    const inside = (p) => a * p[0] + b * p[1] + k < 0; // unter dem Horizont
    // Sutherland-Hodgman: Rechteck an der Halbebene clippen
    let poly = [];
    for (let i = 0; i < 4; i++) {
      const p = corners[i], q = corners[(i + 1) % 4];
      const pi = inside(p), qi = inside(q);
      if (pi) poly.push(p);
      if (pi !== qi) {
        const fp = a * p[0] + b * p[1] + k;
        const fq = a * q[0] + b * q[1] + k;
        const t = fp / (fp - fq);
        poly.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
    if (poly.length < 3) return;
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(poly[0][0], poly[0][1]);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
    ctx.closePath();
    ctx.fillStyle = "rgba(10, 14, 26, 0.62)";
    ctx.fill();
  }

  _drawHorizon() {
    const frame = this._sceneFrame;
    const ctx = this.ctx;
    // Horizontlinie: Punkte bei Hoehe 0 samplen (robust auch am Bildrand)
    const pts = [];
    for (let az = 0; az <= 360; az += 2) {
      const ca = Math.cos(az * D2R), sa = Math.sin(az * D2R);
      pts.push(lincomb(frame.N, ca, frame.E, sa));
    }
    ctx.strokeStyle = "rgba(240, 198, 106, 0.55)";
    ctx.lineWidth = 1.5;
    this._strokePolyline(pts);

    // Himmelsrichtungs-Marken
    ctx.textAlign = "center";
    for (const m of HIMMELSRICHTUNGEN) {
      const ca = Math.cos(m.az * D2R), sa = Math.sin(m.az * D2R);
      const p = this.project(lincomb(frame.N, ca, frame.E, sa));
      if (!this.onScreen(p, 30)) continue;
      ctx.font = m.gross ? "700 17px -apple-system, sans-serif" : "600 12px -apple-system, sans-serif";
      ctx.fillStyle = m.az === 0 ? "rgba(240, 198, 106, 0.95)" : "rgba(240, 198, 106, 0.8)";
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 4);
      ctx.lineTo(p.x, p.y + 4);
      ctx.strokeStyle = "rgba(240, 198, 106, 0.8)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillText(m.txt, p.x, p.y - 10);
    }
    ctx.textAlign = "left";
  }

  // --- Sonne, Mond, Planeten ----------------------------------------------
  _drawBodies(bodies) {
    const ctx = this.ctx;
    const drawn = [];
    const frame = this._sceneFrame;
    let sunP = null;
    const sun = bodies.find((b) => b.type === "sonne");
    if (sun) sunP = this._camCoords(sun.v);

    for (const b of bodies) {
      const p = this.project(b.v);
      if (!this.onScreen(p, 40)) continue;
      const altSin = dot(b.v, frame.U);
      const belowAlpha = altSin < 0 ? 0.35 : 1.0;
      const pxDeg = this.pxPerDeg();
      let r;
      ctx.save();
      ctx.globalAlpha = belowAlpha;
      if (b.type === "sonne") {
        r = Math.max(7, (b.angRadiusDeg || 0.267) * pxDeg);
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2.4);
        grad.addColorStop(0, "rgba(255, 244, 214, 1)");
        grad.addColorStop(0.45, "rgba(255, 220, 130, 0.85)");
        grad.addColorStop(1, "rgba(255, 200, 80, 0)");
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(p.x, p.y, r * 2.4, 0, 6.2832); ctx.fill();
        ctx.fillStyle = "#fff6dc";
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 6.2832); ctx.fill();
      } else if (b.type === "mond") {
        r = Math.max(7, (b.angRadiusDeg || 0.259) * pxDeg);
        this._drawMoon(p, r, b.moon, sunP, this._camCoords(b.v));
      } else { // Planet
        r = Math.max(2.5, Math.min(6, 5 - (b.mag ?? 1) * 0.7));
        ctx.fillStyle = PLANETEN_FARBEN[b.key] || "#e8d9b0";
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 6.2832); ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
      // Label
      ctx.font = "600 12px -apple-system, sans-serif";
      ctx.fillStyle = `rgba(233, 237, 248, ${0.85 * belowAlpha})`;
      const wpx = ctx.measureText(b.name).width;
      if (this._placeLabel(p.x + r + 5, p.y - 6, wpx, 13)) {
        ctx.fillText(b.name, p.x + r + 5, p.y + 4);
      }
      ctx.restore();
      drawn.push({ key: b.key, x: p.x, y: p.y, r: Math.max(r, 10), altSin });
    }
    return drawn;
  }

  _camCoords(v) {
    const c = this.cam;
    return { x: dot(v, c.right), y: dot(v, c.up), z: dot(v, c.fwd) };
  }

  // Mondsichel: rechte Halbscheibe + Terminator-Ellipse, gedreht zur Sonne.
  _drawMoon(p, r, moon, sunCam, moonCam) {
    const ctx = this.ctx;
    const f = moon ? moon.illumFraction : 1;
    const k = 2 * f - 1;
    // Winkel zur Sonne auf dem Schirm: heller Rand zeigt zur Sonne. Die
    // Differenz der Kamerakoordinaten liefert die Richtung auch dann, wenn
    // die Sonne hinter der Kamera oder unter dem Horizont steht.
    let ang = -Math.PI / 2; // Default: hell oben
    if (sunCam && moonCam) {
      const dx = sunCam.x - moonCam.x;
      const dy = sunCam.y - moonCam.y;
      if (dx * dx + dy * dy > 1e-9) ang = Math.atan2(-dy, dx);
    }
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(ang);
    // dunkle Scheibe (Erdschein)
    ctx.fillStyle = "rgba(70, 78, 100, 0.85)";
    ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.2832); ctx.fill();
    // beleuchteter Teil
    ctx.fillStyle = "#f0eee2";
    ctx.beginPath();
    ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);
    ctx.ellipse(0, 0, r * Math.abs(k), r, 0, Math.PI / 2, -Math.PI / 2, k < 0);
    ctx.fill();
    ctx.restore();
  }

  // --- Label-Kollisionen ---------------------------------------------------
  _placeLabel(x, y, w, h) {
    for (const r of this._labels) {
      if (x < r.x + r.w + 4 && x + w + 4 > r.x && y < r.y + r.h + 2 && y + h + 2 > r.y) return false;
    }
    this._labels.push({ x, y, w, h });
    return true;
  }
}
