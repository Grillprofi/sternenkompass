/* Sternenkompass – js/sensors.js
 *
 * Blickrichtungs-Steuerung mit zwei Modi:
 *
 *  - "sensor": DeviceOrientation. iOS verlangt requestPermission() aus einer
 *    User-Geste. webkitCompassHeading wird bevorzugt (echter Kompass-Nordwert),
 *    sonst deviceorientationabsolute bzw. alpha. Die Rohwerte werden ueber die
 *    W3C-Rotationsmatrix in eine Blickrichtung (Az/Alt/Roll) umgerechnet und
 *    als 3D-Vektor tiefpassgefiltert – dadurch kein Sprung am Nord-Uebergang.
 *    Die Screen-Orientierung (Portrait/Landscape) wird beruecksichtigt.
 *
 *  - "manuell": Ein-Finger-Schwenken mit traegem Nachlaufen und Ausrollen,
 *    Pinch-Zoom auf das FOV (20–100 Grad). Maus-Drag und Mausrad funktionieren
 *    fuer Desktop-Tests ebenfalls.
 *
 * app.js ruft pro Frame controller.update(dtMs) auf und erhaelt
 * { azDeg, altDeg, rollDeg, fovDeg, mode }.
 */

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

function norm360(x) { return ((x % 360) + 360) % 360; }
function clamp(x, a, b) { return Math.min(b, Math.max(a, x)); }

export const DEFAULT_OBSERVER = { latDeg: 51.4556, lonDeg: 7.0116 }; // Essen

// ---------------------------------------------------------------------------
// DeviceOrientation -> Blickrichtung
// Erdsystem: x = Ost, y = Nord, z = oben. R = Rz(alpha)*Rx(beta)*Ry(gamma)
// bildet Geraetekoordinaten auf das Erdsystem ab (W3C-Konvention).
// Blickrichtung = Rueckkamera = -3. Spalte von R; die 3. Spalte ist von der
// Screen-Rotation unabhaengig, nur "Bildschirm-oben" (fuer Roll) dreht mit.
// ---------------------------------------------------------------------------

function orientationToView(alphaDeg, betaDeg, gammaDeg, screenAngleDeg) {
  const ca = Math.cos(alphaDeg * D2R), sa = Math.sin(alphaDeg * D2R);
  const cb = Math.cos(betaDeg * D2R), sb = Math.sin(betaDeg * D2R);
  const cg = Math.cos(gammaDeg * D2R), sg = Math.sin(gammaDeg * D2R);

  // Spalten von R (Geraete-x, -y, -z im Erdsystem)
  const col1 = [ca * cg - sa * sb * sg, sa * cg + ca * sb * sg, -cb * sg];
  const col2 = [-sa * cb, ca * cb, sb];
  const col3 = [ca * sg + sa * sb * cg, sa * sg - ca * sb * cg, cb * cg];

  // Blickrichtung (Rueckkamera)
  const v = [-col3[0], -col3[1], -col3[2]];

  // "Bildschirm-oben" im Erdsystem, um die Screen-Rotation korrigiert
  const s = screenAngleDeg * D2R;
  const cs = Math.cos(s), ss = Math.sin(s);
  const upScr = [
    col1[0] * ss + col2[0] * cs,
    col1[1] * ss + col2[1] * cs,
    col1[2] * ss + col2[2] * cs,
  ];

  const azDeg = norm360(Math.atan2(v[0], v[1]) * R2D);
  const altDeg = Math.asin(clamp(v[2], -1, 1)) * R2D;

  // Roll: Bildschirm-oben gegen das lokale "oben senkrecht zur Blickrichtung"
  let rollDeg = 0;
  const fxU = [v[1], -v[0], 0]; // v x Up (rechts), Betrag = cos(alt)
  const n = Math.hypot(fxU[0], fxU[1]);
  if (n > 1e-4) {
    const right0 = [fxU[0] / n, fxU[1] / n, 0];
    const up0 = [
      right0[1] * v[2] - right0[2] * v[1],
      right0[2] * v[0] - right0[0] * v[2],
      right0[0] * v[1] - right0[1] * v[0],
    ]; // right0 x v
    const x = upScr[0] * right0[0] + upScr[1] * right0[1] + upScr[2] * right0[2];
    const y = upScr[0] * up0[0] + upScr[1] * up0[1] + upScr[2] * up0[2];
    rollDeg = Math.atan2(x, y) * R2D;
  }
  return { azDeg, altDeg, rollDeg };
}

function screenAngle() {
  if (screen.orientation && typeof screen.orientation.angle === "number") {
    return screen.orientation.angle;
  }
  return typeof window.orientation === "number" ? window.orientation : 0;
}

// ---------------------------------------------------------------------------
// ViewController
// ---------------------------------------------------------------------------

export function createViewController(opts) {
  const el = opts.element;
  const onTap = opts.onTap || (() => {});
  const onModeChange = opts.onModeChange || (() => {});
  const onSensorStatus = opts.onSensorStatus || (() => {});
  // Pixel pro Grad fuer Gesten (app liefert aktuellen Wert des Renderers)
  const pxPerDeg = opts.pxPerDeg || (() => 12);

  const view = { azDeg: 180, altDeg: 25, rollDeg: 0, fovDeg: 60 }; // Start: Blick nach Sueden
  let mode = "manuell";

  // --- Sensor-Zustand ---
  let sensorTarget = null;     // { vec:[x,y,z] Erdsystem, rollDeg }
  let sensorSmooth = null;
  let sensorRollSmooth = 0;
  let sensorEventSeen = false;
  let sensorListening = false;
  let sensorWatchdog = 0;

  // --- Manuell-Zustand ---
  const manual = {
    targetAz: view.azDeg,
    targetAlt: view.altDeg,
    velAz: 0,
    velAlt: 0,
    dragging: false,
  };

  // --- Pointer-Gesten ---
  const pointers = new Map();
  let pinchStartDist = 0;
  let pinchStartFov = 60;
  let downInfo = null;
  let lastMove = null;

  function setMode(m, reason) {
    if (mode === m) return;
    mode = m;
    if (m === "manuell") {
      manual.targetAz = view.azDeg;
      manual.targetAlt = view.altDeg;
      manual.velAz = 0;
      manual.velAlt = 0;
      view.rollDeg = 0;
    }
    onModeChange(mode, reason);
  }

  // ----- Sensor-Handling ---------------------------------------------------

  // Nord-Korrektur: Differenz zwischen Kompass-Azimut (webkitCompassHeading)
  // und dem Azimut aus der kontinuierlichen Gyro-Lage (alpha/beta/gamma).
  // Der Kompasswert wird NIE direkt als alpha eingesetzt (er ist beim steilen
  // Hochhalten instabil und inkonsistent zu beta/gamma, was wilde Spruenge
  // erzeugt). Stattdessen wird er als langsam nachgefuehrter Offset auf die
  // in sich glatte Gyro-Lage addiert, und nur dann gelernt, wenn das Geraet
  // flach genug ist (Kompass zuverlaessig) und die iOS-Genauigkeit ok ist.
  let headingOffsetDeg = null; // zirkulaer gemittelt
  let headingOffsetInit = false;

  function circularLerpDeg(fromDeg, toDeg, k) {
    let d = ((toDeg - fromDeg + 540) % 360) - 180;
    return (fromDeg + k * d + 360) % 360;
  }

  function handleOrientation(ev) {
    const alpha = ev.alpha, beta = ev.beta, gamma = ev.gamma;
    if (alpha == null || beta == null || gamma == null) return;

    // Kontinuierliche Lage aus dem konsistenten Winkeltriplett.
    const t = orientationToView(alpha, beta, gamma, screenAngle());

    const hasCompass = typeof ev.webkitCompassHeading === "number" &&
      !Number.isNaN(ev.webkitCompassHeading) && ev.webkitCompassHeading >= 0;
    if (hasCompass) {
      // Genauigkeit: iOS liefert webkitCompassAccuracy in Grad (-1 = ungueltig).
      const acc = typeof ev.webkitCompassAccuracy === "number" ? ev.webkitCompassAccuracy : 999;
      const accOk = acc >= 0 && acc <= 35;
      // Kompass nur lernen, solange nicht steil in den Himmel gezielt wird.
      const flatEnough = Math.abs(t.altDeg) < 55;
      // Kompass-konsistente Lage exakt wie die Gyro-Lage berechnen
      // (alpha_absolut = 360 - webkitCompassHeading); die Differenz der
      // Azimute ist dann eine reine Drehung um die Vertikale und damit
      // fuer jede Haltung des Geraets der richtige Offset.
      const tc = orientationToView(360 - ev.webkitCompassHeading, beta, gamma, screenAngle());
      const offset = ((tc.azDeg - t.azDeg) % 360 + 360) % 360;
      if (!headingOffsetInit && (accOk || acc === 999)) {
        headingOffsetDeg = offset;
        headingOffsetInit = true;
      } else if (headingOffsetInit && accOk && flatEnough) {
        // sehr traege nachfuehren (Gyro-Drift-Korrektur, keine Spruenge)
        headingOffsetDeg = circularLerpDeg(headingOffsetDeg, offset, 0.02);
      }
    } else if (ev.type === "deviceorientation" && ev.absolute !== true && !handleOrientation._warned) {
      // Nur relative Werte verfuegbar: Norden stimmt evtl. nicht.
      handleOrientation._warned = true;
      onSensorStatus("relativ");
    }

    const azDeg = headingOffsetInit ? (t.azDeg + headingOffsetDeg) % 360 : t.azDeg;
    const ch = Math.cos(t.altDeg * D2R);
    sensorTarget = {
      vec: [ch * Math.sin(azDeg * D2R), ch * Math.cos(azDeg * D2R), Math.sin(t.altDeg * D2R)],
      rollDeg: t.rollDeg,
    };
    sensorEventSeen = true;
  }

  function startListening() {
    if (sensorListening) return;
    sensorListening = true;
    // Nach Tab-Wechsel/Sperren kann iOS die Gyro-Referenz (alpha) neu setzen:
    // Nord-Offset dann neu vom Kompass lernen statt mit veraltetem Wert starten.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") headingOffsetInit = false;
    });
    // deviceorientationabsolute (Android/Chrome) bevorzugen, wenn vorhanden
    if ("ondeviceorientationabsolute" in window) {
      window.addEventListener("deviceorientationabsolute", handleOrientation, true);
    }
    window.addEventListener("deviceorientation", handleOrientation, true);
  }

  // Muss aus einer User-Geste aufgerufen werden (iOS-Freigabedialog).
  async function enableSensors() {
    try {
      if (typeof DeviceOrientationEvent !== "undefined" &&
          typeof DeviceOrientationEvent.requestPermission === "function") {
        const res = await DeviceOrientationEvent.requestPermission();
        if (res !== "granted") {
          setMode("manuell", "abgelehnt");
          onSensorStatus("abgelehnt");
          return false;
        }
      }
    } catch (e) {
      setMode("manuell", "fehler");
      onSensorStatus("fehler");
      return false;
    }
    startListening();
    setMode("sensor");
    sensorEventSeen = false;
    clearTimeout(sensorWatchdog);
    // Kommen binnen 2 s keine Daten, automatisch auf manuell zurueckfallen.
    sensorWatchdog = setTimeout(() => {
      if (mode === "sensor" && !sensorEventSeen) {
        setMode("manuell", "keine-daten");
        onSensorStatus("keine-daten");
      }
    }, 2000);
    return true;
  }

  // ----- Gesten ------------------------------------------------------------

  function onPointerDown(ev) {
    el.setPointerCapture && el.setPointerCapture(ev.pointerId);
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pointers.size === 1) {
      downInfo = { x: ev.clientX, y: ev.clientY, t: performance.now(), moved: 0 };
      lastMove = { x: ev.clientX, y: ev.clientY, t: performance.now() };
      manual.dragging = true;
      manual.velAz = 0;
      manual.velAlt = 0;
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStartDist = Math.hypot(a.x - b.x, a.y - b.y);
      pinchStartFov = view.fovDeg;
      manual.dragging = false;
    }
    ev.preventDefault();
  }

  function onPointerMove(ev) {
    const p = pointers.get(ev.pointerId);
    if (!p) return;
    const px = p.x, py = p.y;
    p.x = ev.clientX; p.y = ev.clientY;

    if (pointers.size === 2 && pinchStartDist > 0) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > 10) {
        view.fovDeg = clamp(pinchStartFov * pinchStartDist / d, 20, 100);
      }
      return;
    }
    if (pointers.size !== 1) return;

    const dx = ev.clientX - px;
    const dy = ev.clientY - py;
    if (downInfo) downInfo.moved += Math.abs(dx) + Math.abs(dy);

    if (mode === "sensor") {
      // Wischen im Sensormodus wechselt bewusst zu manuell.
      if (downInfo && downInfo.moved > 24) setMode("manuell", "geste");
      else return;
    }
    const ppd = Math.max(2, pxPerDeg());
    manual.targetAz = norm360(manual.targetAz - dx / ppd);
    manual.targetAlt = clamp(manual.targetAlt + dy / ppd, -89, 89);

    const now = performance.now();
    if (lastMove && now - lastMove.t > 0) {
      const dt = (now - lastMove.t) / 1000;
      manual.velAz = -((ev.clientX - lastMove.x) / ppd) / dt;
      manual.velAlt = ((ev.clientY - lastMove.y) / ppd) / dt;
    }
    lastMove = { x: ev.clientX, y: ev.clientY, t: now };
  }

  function onPointerUp(ev) {
    pointers.delete(ev.pointerId);
    if (pointers.size < 2) pinchStartDist = 0;
    if (pointers.size === 0) {
      manual.dragging = false;
      if (downInfo) {
        const dt = performance.now() - downInfo.t;
        if (downInfo.moved < 10 && dt < 350) {
          manual.velAz = 0;
          manual.velAlt = 0;
          onTap(downInfo.x, downInfo.y);
        }
        // Ausrollen nur nach schnellem Wischen
        if (downInfo.moved < 10 || performance.now() - (lastMove ? lastMove.t : 0) > 80) {
          manual.velAz = 0;
          manual.velAlt = 0;
        }
      }
      downInfo = null;
    }
  }

  function onWheel(ev) {
    ev.preventDefault();
    if (mode === "sensor") return;
    view.fovDeg = clamp(view.fovDeg * (ev.deltaY > 0 ? 1.07 : 1 / 1.07), 20, 100);
  }

  el.addEventListener("pointerdown", onPointerDown);
  el.addEventListener("pointermove", onPointerMove);
  el.addEventListener("pointerup", onPointerUp);
  el.addEventListener("pointercancel", onPointerUp);
  el.addEventListener("wheel", onWheel, { passive: false });

  // ----- Update pro Frame --------------------------------------------------

  function update(dtMs) {
    const dt = Math.min(dtMs, 100) / 1000;

    if (mode === "sensor" && sensorTarget) {
      // Tiefpass auf dem Richtungsvektor (kein 0/360-Sprung), Roll separat.
      const k = 1 - Math.exp(-dt / 0.12);
      if (!sensorSmooth) {
        sensorSmooth = sensorTarget.vec.slice();
        sensorRollSmooth = sensorTarget.rollDeg;
      } else {
        for (let i = 0; i < 3; i++) {
          sensorSmooth[i] += (sensorTarget.vec[i] - sensorSmooth[i]) * k;
        }
        let dR = sensorTarget.rollDeg - sensorRollSmooth;
        dR = ((dR + 540) % 360) - 180;
        sensorRollSmooth += dR * k;
      }
      const n = Math.hypot(sensorSmooth[0], sensorSmooth[1], sensorSmooth[2]) || 1;
      const vx = sensorSmooth[0] / n, vy = sensorSmooth[1] / n, vz = sensorSmooth[2] / n;
      view.azDeg = norm360(Math.atan2(vx, vy) * R2D);
      view.altDeg = Math.asin(clamp(vz, -1, 1)) * R2D;
      view.rollDeg = ((sensorRollSmooth % 360) + 540) % 360 - 180;
    } else if (mode === "manuell") {
      if (!manual.dragging) {
        // Traegheit mit Daempfung
        const damp = Math.exp(-dt / 0.35);
        manual.velAz *= damp;
        manual.velAlt *= damp;
        if (Math.abs(manual.velAz) < 0.05) manual.velAz = 0;
        if (Math.abs(manual.velAlt) < 0.05) manual.velAlt = 0;
        manual.targetAz = norm360(manual.targetAz + manual.velAz * dt);
        manual.targetAlt = clamp(manual.targetAlt + manual.velAlt * dt, -89, 89);
      }
      // traeges Nachlaufen zur Zielrichtung
      const k = 1 - Math.exp(-dt / 0.09);
      let dAz = manual.targetAz - view.azDeg;
      dAz = ((dAz + 540) % 360) - 180;
      view.azDeg = norm360(view.azDeg + dAz * k);
      view.altDeg += (manual.targetAlt - view.altDeg) * k;
      view.rollDeg = 0;
    }
    return { azDeg: view.azDeg, altDeg: view.altDeg, rollDeg: view.rollDeg, fovDeg: view.fovDeg, mode };
  }

  return {
    get mode() { return mode; },
    get view() { return view; },
    enableSensors,
    setModeManual(reason) { setMode("manuell", reason); },
    async setModeSensor() { return enableSensors(); },
    update,
    lookAt(azDeg, altDeg) {
      view.azDeg = norm360(azDeg);
      view.altDeg = clamp(altDeg, -89, 89);
      manual.targetAz = view.azDeg;
      manual.targetAlt = view.altDeg;
    },
  };
}

// ---------------------------------------------------------------------------
// Geolocation (Button-gesteuert). Liefert Promise auf { latDeg, lonDeg }.
// ---------------------------------------------------------------------------

export function requestLocation() {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("Geolocation nicht verfuegbar"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latDeg: pos.coords.latitude, lonDeg: pos.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 600000 }
    );
  });
}
