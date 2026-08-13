/* Sternenkompass – js/app.js
 *
 * Verdrahtung: Zustand { date, observer, view, settings }, Datenladen,
 * Tick-Loop (Sonne/Mond/Planeten 1x pro Sekunde, Sterne pro Frame nur ueber
 * die Sternzeit rotiert), Antipp-Picking, Info-Panel, Nachtmodus, Statuszeile,
 * Service-Worker-Registrierung.
 *
 * Testhook: ?autostart=1 ueberspringt das Start-Overlay (manueller Modus),
 * damit Headless-Screenshots die Karte zeigen.
 */

import * as astro from "./astro.js";
import { StarRenderer, raDecToVec } from "./render.js";
import { createViewController, requestLocation, DEFAULT_OBSERVER } from "./sensors.js";

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

// ---------------------------------------------------------------------------
// Zustand
// ---------------------------------------------------------------------------

const state = {
  date: new Date(),
  observer: { ...DEFAULT_OBSERVER },
  observerLabel: "Essen",
  view: null, // kommt pro Frame vom ViewController
  settings: {
    linien: true,
    sternbildNamen: true,
    sternnamen: true,
    gitter: false,
    nachtmodus: false,
  },
  daten: {
    stars: null,          // Meta-Objekte parallel zu den GPU-Puffern
    hipIndex: new Map(),  // HIP -> Sternindex
    cons: null,           // Sternbilder (aufbereitet)
    objekte: null,        // objects.json
    fehlend: [],
  },
  bodies: [],             // Sonne/Mond/Planeten, 1x pro Sekunde erneuert
  drawnBodies: [],        // letzte Schirmpositionen (Picking)
  auswahl: null,          // aktuell gewaehltes Objekt
};

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);
const el = {
  sterneCanvas: $("sterne-canvas"),
  overlayCanvas: $("overlay-canvas"),
  statusOrt: $("status-ort"),
  statusZeit: $("status-zeit"),
  statusBlick: $("status-blick"),
  btnStandort: $("btn-standort"),
  btnModus: $("btn-modus"),
  btnNacht: $("btn-nacht"),
  btnEinstellungen: $("btn-einstellungen"),
  einstellungen: $("einstellungen"),
  optLinien: $("opt-linien"),
  optSternbildnamen: $("opt-sternbildnamen"),
  optSternnamen: $("opt-sternnamen"),
  optGitter: $("opt-gitter"),
  infoPanel: $("info-panel"),
  infoName: $("info-name"),
  infoUntertitel: $("info-untertitel"),
  infoMag: $("info-mag"),
  infoDist: $("info-dist"),
  infoAzalt: $("info-azalt"),
  infoHorizont: $("info-horizont"),
  infoText: $("info-text"),
  infoSchliessen: $("info-schliessen"),
  fehlerBanner: $("fehler-banner"),
  fehlerText: $("fehler-text"),
  fehlerSchliessen: $("fehler-schliessen"),
  hinweis: $("hinweis"),
  startOverlay: $("start-overlay"),
  btnStartSensoren: $("btn-start-sensoren"),
  btnStartManuell: $("btn-start-manuell"),
};

const renderer = new StarRenderer(el.sterneCanvas, el.overlayCanvas);

const controller = createViewController({
  element: el.overlayCanvas,
  pxPerDeg: () => renderer.pxPerDeg(),
  onTap: handleTap,
  onModeChange: (mode, reason) => {
    aktualisiereModusButton();
    if (reason === "abgelehnt") zeigeHinweis("Sensor-Zugriff abgelehnt – manueller Modus aktiv.");
    else if (reason === "keine-daten" || reason === "fehler") {
      zeigeHinweis("Keine Sensordaten verfügbar – manueller Modus aktiv.");
    } else if (reason === "geste") zeigeHinweis("Manueller Modus (Wischen). Sensor über den Kompass-Knopf.");
  },
  onSensorStatus: (status) => {
    if (status === "relativ") zeigeHinweis("Kein Kompass verfügbar – Nordrichtung evtl. ungenau.");
  },
});

// ---------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------

const RICHTUNGEN = ["Nord", "Nordost", "Ost", "Südost", "Süd", "Südwest", "West", "Nordwest"];
const RICHTUNGEN_KURZ = ["N", "NO", "O", "SO", "S", "SW", "W", "NW"];

function richtungsText(azDeg, kurz = false) {
  const i = Math.round(((azDeg % 360) + 360) % 360 / 45) % 8;
  return (kurz ? RICHTUNGEN_KURZ : RICHTUNGEN)[i];
}

function fmtDe(n, dec = 0) {
  return n.toLocaleString("de-DE", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function fmtMag(m) {
  return Number.isFinite(m) ? (m < 0 ? "−" : "") + Math.abs(m).toFixed(1).replace(".", ",") + " mag" : "–";
}

function zeigeHinweis(text, dauerMs = 4000) {
  el.hinweis.textContent = text;
  el.hinweis.hidden = false;
  clearTimeout(zeigeHinweis._t);
  zeigeHinweis._t = setTimeout(() => { el.hinweis.hidden = true; }, dauerMs);
}

function zeigeFehler(text) {
  el.fehlerText.textContent = text;
  el.fehlerBanner.hidden = false;
}

// Horizontsystem-Basis (N, E, U) als aequatoriale Vektoren fuer jd + Ort.
function horizontBasis(jd, obs) {
  const lst = (astro.gmstDeg(jd) + obs.lonDeg) * D2R;
  const phi = obs.latDeg * D2R;
  const cl = Math.cos(lst), sl = Math.sin(lst);
  const cp = Math.cos(phi), sp = Math.sin(phi);
  return {
    N: [-sp * cl, -sp * sl, cp],
    E: [-sl, cl, 0],
    U: [cp * cl, cp * sl, sp],
  };
}

function vecAltAz(v, frame) {
  const n = v[0] * frame.N[0] + v[1] * frame.N[1] + v[2] * frame.N[2];
  const e = v[0] * frame.E[0] + v[1] * frame.E[1] + v[2] * frame.E[2];
  const u = v[0] * frame.U[0] + v[1] * frame.U[1] + v[2] * frame.U[2];
  return {
    azDeg: ((Math.atan2(e, n) * R2D) + 360) % 360,
    altDeg: Math.asin(Math.max(-1, Math.min(1, u))) * R2D,
  };
}

// ---------------------------------------------------------------------------
// Daten laden
// ---------------------------------------------------------------------------

async function ladeJson(pfad) {
  const res = await fetch(pfad, { cache: "default" });
  if (!res.ok) throw new Error(`${pfad}: HTTP ${res.status}`);
  return res.json();
}

async function ladeDaten() {
  const jd = astro.jdFromDate(new Date());
  const fehlend = [];

  // Sterne
  try {
    const json = await ladeJson("data/stars.json");
    const rohSterne = json.stars || [];
    const n = rohSterne.length;
    const vecs = new Float32Array(n * 3);
    const mags = new Float32Array(n);
    const bvs = new Float32Array(n);
    const meta = new Array(n);
    for (let i = 0; i < n; i++) {
      const [raDeg, decDeg, mag, bv, hip, name, bayer, con, distLj, spek] = rohSterne[i];
      // Praezession J2000 -> Aequinoktium des Datums, einmalig beim Laden
      // (Contract, Abschnitt "Abweichungen").
      const p = astro.precessStarJ2000ToDate(raDeg, decDeg, jd);
      const v = raDecToVec(p.raDeg, p.decDeg);
      vecs[i * 3] = v[0]; vecs[i * 3 + 1] = v[1]; vecs[i * 3 + 2] = v[2];
      mags[i] = mag;
      bvs[i] = bv;
      meta[i] = { name: name || "", bayer: bayer || "", con: con || "", mag, distLj, spek: spek || "", hip };
      if (hip) state.daten.hipIndex.set(hip, i);
    }
    renderer.setStars(vecs, mags, bvs, meta);
    state.daten.stars = { vecs, mags, meta, count: n };
  } catch (e) {
    console.warn("stars.json fehlt:", e.message);
    fehlend.push("Sternkatalog (stars.json)");
  }

  // Sternbilder
  try {
    const json = await ladeJson("data/constellations.json");
    if (state.daten.stars) {
      const cons = [];
      for (const [key, c] of Object.entries(json)) {
        const lineIdx = [];
        for (const line of c.lines || []) {
          let seg = [];
          for (const hip of line) {
            const idx = state.daten.hipIndex.get(hip);
            if (idx === undefined) {
              if (seg.length > 1) lineIdx.push(seg);
              seg = [];
            } else {
              seg.push(idx);
            }
          }
          if (seg.length > 1) lineIdx.push(seg);
        }
        // Schwerpunkt der Mitgliedssterne fuer den Namens-Anker
        const sum = [0, 0, 0];
        let cnt = 0;
        for (const seg of lineIdx) for (const idx of seg) {
          sum[0] += state.daten.stars.vecs[idx * 3];
          sum[1] += state.daten.stars.vecs[idx * 3 + 1];
          sum[2] += state.daten.stars.vecs[idx * 3 + 2];
          cnt++;
        }
        const len = Math.hypot(sum[0], sum[1], sum[2]) || 1;
        cons.push({
          key, de: c.de || key, lat: c.lat || "", info: c.info || "",
          lineIdx, centerVec: [sum[0] / len, sum[1] / len, sum[2] / len],
        });
      }
      renderer.setConstellations(cons);
      state.daten.cons = cons;
    }
  } catch (e) {
    console.warn("constellations.json fehlt:", e.message);
    fehlend.push("Sternbilder (constellations.json)");
  }

  // Infotexte
  try {
    state.daten.objekte = await ladeJson("data/objects.json");
  } catch (e) {
    console.warn("objects.json fehlt:", e.message);
    fehlend.push("Infotexte (objects.json)");
  }

  state.daten.fehlend = fehlend;
  if (fehlend.length > 0) {
    zeigeFehler(
      "Einige Himmelsdaten konnten nicht geladen werden: " + fehlend.join(", ") + ". " +
      "Sonne, Mond und Planeten werden trotzdem angezeigt. " +
      "Bitte später erneut laden – die Daten werden gerade erzeugt oder es besteht keine Verbindung."
    );
  }
}

// ---------------------------------------------------------------------------
// Sonne, Mond, Planeten (1x pro Sekunde)
// ---------------------------------------------------------------------------

const PLANETEN_NAMEN_DE = {
  merkur: "Merkur", venus: "Venus", mars: "Mars", jupiter: "Jupiter",
  saturn: "Saturn", uranus: "Uranus", neptun: "Neptun",
};

function aktualisiereKoerper() {
  const jd = astro.jdFromDate(state.date);
  const bodies = [];

  const s = astro.sunEquatorial(jd);
  bodies.push({
    key: "sonne", name: "Sonne", type: "sonne",
    v: raDecToVec(s.raDeg, s.decDeg),
    distAU: s.distAU, angRadiusDeg: 0.267 / s.distAU, mag: -26.7,
  });

  const m = astro.moonEquatorial(jd);
  bodies.push({
    key: "mond", name: "Mond", type: "mond",
    v: raDecToVec(m.raDeg, m.decDeg),
    distKm: m.distKm,
    angRadiusDeg: Math.asin(1737.4 / m.distKm) * R2D,
    moon: { illumFraction: m.illumFraction, isWaxing: m.isWaxing },
    mag: NaN,
  });

  for (const name of astro.PLANET_NAMES) {
    const p = astro.planetEquatorial(name, jd);
    bodies.push({
      key: name, name: PLANETEN_NAMEN_DE[name], type: "planet",
      v: raDecToVec(p.raDeg, p.decDeg),
      distAU: p.distAU, mag: p.magnitude,
    });
  }
  state.bodies = bodies;
}

// ---------------------------------------------------------------------------
// Render-Loop
// ---------------------------------------------------------------------------

let letzterFrame = performance.now();

function frame(now) {
  const dtMs = now - letzterFrame;
  letzterFrame = now;
  state.date = new Date();
  state.view = controller.update(dtMs);

  const jd = astro.jdFromDate(state.date);
  const basis = horizontBasis(jd, state.observer);
  state.frame = basis;

  state.drawnBodies = renderer.render({
    view: state.view,
    frame: basis,
    settings: state.settings,
    bodies: state.bodies,
  });

  aktualisiereAuswahlLive();
  requestAnimationFrame(frame);
}

// Statuszeile + Koerper im Sekundentakt
function tick() {
  aktualisiereKoerper();
  const d = state.date;
  el.statusZeit.textContent = d.toLocaleTimeString("de-DE", { hour12: false });
  if (state.view) {
    const az = Math.round(state.view.azDeg);
    const alt = Math.round(state.view.altDeg);
    el.statusBlick.textContent =
      `${richtungsText(az, true)} ${az}° · ${alt >= 0 ? "+" : "−"}${Math.abs(alt)}°`;
  }
  el.statusOrt.textContent = state.observerLabel;
}

// ---------------------------------------------------------------------------
// Picking (Antippen, Radius 24 px)
// ---------------------------------------------------------------------------

const PICK_RADIUS = 24;

function handleTap(x, y) {
  // Offene Flaechen-UI zuerst schliessen
  if (!el.einstellungen.hidden) { schliesseEinstellungen(); return; }

  // 1) Planeten / Mond / Sonne
  let best = null;
  for (const b of state.drawnBodies) {
    const d = Math.hypot(b.x - x, b.y - y);
    if (d <= Math.max(PICK_RADIUS, b.r) && (!best || d < best.d)) {
      best = { d, key: b.key };
    }
  }
  if (best) {
    const body = state.bodies.find((b) => b.key === best.key);
    if (body) { waehleKoerper(body); return; }
  }

  // 2) Sterne: im Radius den hellsten (kleinste Magnitude) nehmen
  if (state.daten.stars) {
    const { vecs, mags, count } = state.daten.stars;
    let sBest = -1, sBestMag = Infinity;
    const v = [0, 0, 0];
    for (let i = 0; i < count; i++) {
      v[0] = vecs[i * 3]; v[1] = vecs[i * 3 + 1]; v[2] = vecs[i * 3 + 2];
      const p = renderer.project(v);
      if (!p || p.z <= 0) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d <= PICK_RADIUS && mags[i] < sBestMag) {
        sBest = i; sBestMag = mags[i];
      }
    }
    if (sBest >= 0) { waehleStern(sBest); return; }
  }

  // 3) Sternbild ueber Liniennaehe
  if (state.daten.cons) {
    const { vecs } = state.daten.stars;
    let cBest = null, cBestD = PICK_RADIUS;
    const va = [0, 0, 0], vb = [0, 0, 0];
    for (const con of state.daten.cons) {
      for (const seg of con.lineIdx) {
        for (let i = 0; i + 1 < seg.length; i++) {
          va[0] = vecs[seg[i] * 3]; va[1] = vecs[seg[i] * 3 + 1]; va[2] = vecs[seg[i] * 3 + 2];
          vb[0] = vecs[seg[i + 1] * 3]; vb[1] = vecs[seg[i + 1] * 3 + 1]; vb[2] = vecs[seg[i + 1] * 3 + 2];
          const pa = renderer.project(va), pb = renderer.project(vb);
          if (!pa || !pb || pa.z <= 0 || pb.z <= 0) continue;
          const d = punktSegmentAbstand(x, y, pa.x, pa.y, pb.x, pb.y);
          if (d < cBestD) { cBestD = d; cBest = con; }
        }
      }
    }
    if (cBest) { waehleSternbild(cBest); return; }
  }

  // Nichts getroffen: Panel schliessen
  schliesseInfo();
}

function punktSegmentAbstand(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// ---------------------------------------------------------------------------
// Info-Panel
// ---------------------------------------------------------------------------

function sternbildName(conKey) {
  if (!state.daten.cons) return null;
  return state.daten.cons.find((c) => c.key === conKey) || null;
}

function waehleStern(idx) {
  const st = state.daten.stars.meta[idx];
  const con = sternbildName(st.con);
  const name = st.name || st.bayer || (st.hip ? `HIP ${st.hip}` : "Stern");
  el.infoName.innerHTML = "";
  el.infoName.appendChild(document.createTextNode(name));
  if (st.name && st.bayer) {
    const span = document.createElement("span");
    span.className = "bayer";
    span.textContent = ` · ${st.bayer}`;
    el.infoName.appendChild(span);
  }
  el.infoUntertitel.textContent = "Stern" + (con ? ` · ${con.de} (${con.lat})` : "");
  el.infoMag.textContent = fmtMag(st.mag);
  el.infoDist.textContent = st.distLj > 0 ? `${fmtDe(st.distLj)} Lj` : "–";
  el.infoText.textContent = sternInfoText(st, name, con);
  const i = idx;
  state.auswahl = {
    getVec: () => {
      const v = state.daten.stars.vecs;
      return [v[i * 3], v[i * 3 + 1], v[i * 3 + 2]];
    },
  };
  el.infoPanel.hidden = false;
}

function sternInfoText(st, name, con) {
  const teile = [];
  let satz = `${name} ist ein Stern`;
  if (st.spek) satz += ` der Spektralklasse ${st.spek}`;
  if (con) satz += ` im Sternbild ${con.de}`;
  teile.push(satz + ".");
  teile.push(`Die scheinbare Helligkeit beträgt ${fmtMag(st.mag)}.`);
  if (st.distLj > 0) {
    teile.push(`Sein Licht ist rund ${fmtDe(st.distLj)} Jahre zu uns unterwegs.`);
  }
  if (st.mag <= 1.5) {
    teile.push("Damit gehört er zu den hellsten Sternen am Himmel und ist auch in der Stadt gut zu sehen.");
  }
  return teile.join(" ");
}

function waehleKoerper(body) {
  const objInfo = state.daten.objekte ? state.daten.objekte[body.key] : null;
  el.infoName.textContent = body.name;
  const typ = objInfo?.typ || (body.type === "planet" ? "Planet" : body.type === "mond" ? "Mond" : "Stern");
  el.infoUntertitel.textContent = typ;
  el.infoMag.textContent = fmtMag(body.mag);
  if (body.type === "mond") {
    el.infoDist.textContent = `${fmtDe(Math.round(body.distKm))} km`;
  } else {
    el.infoDist.textContent = `${body.distAU.toFixed(2).replace(".", ",")} AE`;
  }
  let text = objInfo?.info || "";
  if (!text) {
    text = body.type === "planet"
      ? `${body.name} ist ein Planet unseres Sonnensystems. Aktuelle Entfernung: ${body.distAU.toFixed(2).replace(".", ",")} AE.`
      : body.type === "mond"
        ? "Der Mond ist der einzige natürliche Satellit der Erde."
        : "Die Sonne ist der Stern im Zentrum unseres Sonnensystems.";
  }
  if (body.type === "mond" && body.moon) {
    const proz = Math.round(body.moon.illumFraction * 100);
    text += ` Aktuell sind ${proz} % der Mondscheibe beleuchtet (${body.moon.isWaxing ? "zunehmend" : "abnehmend"}).`;
  }
  el.infoText.textContent = text;
  const key = body.key;
  state.auswahl = {
    getVec: () => {
      const b = state.bodies.find((x) => x.key === key);
      return b ? b.v : null;
    },
  };
  el.infoPanel.hidden = false;
}

function waehleSternbild(con) {
  el.infoName.textContent = con.de;
  el.infoUntertitel.textContent = `Sternbild · ${con.lat}`;
  el.infoMag.textContent = "–";
  el.infoDist.textContent = "–";
  el.infoText.textContent = con.info ||
    `${con.de} (lateinisch ${con.lat}) ist eines der 88 offiziellen Sternbilder.`;
  state.auswahl = { getVec: () => con.centerVec };
  el.infoPanel.hidden = false;
}

function aktualisiereAuswahlLive() {
  if (!state.auswahl || el.infoPanel.hidden) return;
  const v = state.auswahl.getVec();
  if (!v || !state.frame) return;
  const { azDeg, altDeg } = vecAltAz(v, state.frame);
  const az = Math.round(azDeg);
  const alt = altDeg;
  el.infoAzalt.textContent =
    `${richtungsText(az)} · Az ${az}° · ${alt >= 0 ? "+" : "−"}${Math.abs(alt).toFixed(1).replace(".", ",")}°`;
  el.infoHorizont.textContent = alt >= 0 ? "Über dem Horizont" : "Unter dem Horizont";
  el.infoHorizont.style.color = alt >= 0 ? "#8fd694" : "#e0968f";
}

function schliesseInfo() {
  el.infoPanel.hidden = true;
  state.auswahl = null;
}

// ---------------------------------------------------------------------------
// UI: Einstellungen, Nachtmodus, Modus, Standort
// ---------------------------------------------------------------------------

function ladeEinstellungen() {
  try {
    const raw = localStorage.getItem("sk-einstellungen");
    if (raw) Object.assign(state.settings, JSON.parse(raw));
  } catch (e) { /* ignorieren */ }
  el.optLinien.checked = state.settings.linien;
  el.optSternbildnamen.checked = state.settings.sternbildNamen;
  el.optSternnamen.checked = state.settings.sternnamen;
  el.optGitter.checked = state.settings.gitter;
  if (state.settings.nachtmodus) setzeNachtmodus(true);
}

function speichereEinstellungen() {
  try {
    localStorage.setItem("sk-einstellungen", JSON.stringify(state.settings));
  } catch (e) { /* ignorieren */ }
}

function bindeToggle(input, key) {
  input.addEventListener("change", () => {
    state.settings[key] = input.checked;
    speichereEinstellungen();
  });
}

function schliesseEinstellungen() {
  el.einstellungen.hidden = true;
  el.btnEinstellungen.setAttribute("aria-expanded", "false");
  el.btnEinstellungen.classList.remove("aktiv");
}

function setzeNachtmodus(an) {
  state.settings.nachtmodus = an;
  document.documentElement.classList.toggle("nachtmodus", an);
  el.btnNacht.setAttribute("aria-pressed", String(an));
  el.btnNacht.classList.toggle("aktiv", an);
  speichereEinstellungen();
}

function aktualisiereModusButton() {
  const sensor = controller.mode === "sensor";
  el.btnModus.classList.toggle("aktiv", sensor);
  el.btnModus.title = sensor ? "Sensormodus aktiv – tippen für manuell" : "Manuell – tippen für Sensormodus";
}

function bindeUi() {
  bindeToggle(el.optLinien, "linien");
  bindeToggle(el.optSternbildnamen, "sternbildNamen");
  bindeToggle(el.optSternnamen, "sternnamen");
  bindeToggle(el.optGitter, "gitter");

  el.btnEinstellungen.addEventListener("click", () => {
    const offen = el.einstellungen.hidden;
    el.einstellungen.hidden = !offen;
    el.btnEinstellungen.setAttribute("aria-expanded", String(offen));
    el.btnEinstellungen.classList.toggle("aktiv", offen);
  });

  el.btnNacht.addEventListener("click", () => setzeNachtmodus(!state.settings.nachtmodus));

  el.btnModus.addEventListener("click", async () => {
    if (controller.mode === "sensor") {
      controller.setModeManual("knopf");
      zeigeHinweis("Manueller Modus: Wischen zum Schwenken, Pinch zum Zoomen.");
    } else {
      const ok = await controller.setModeSensor();
      if (ok) zeigeHinweis("Sensormodus: Handy an den Himmel halten.");
    }
    aktualisiereModusButton();
  });

  el.btnStandort.addEventListener("click", async () => {
    zeigeHinweis("Standort wird ermittelt…");
    try {
      const pos = await requestLocation();
      state.observer = pos;
      state.observerLabel =
        `${Math.abs(pos.latDeg).toFixed(2).replace(".", ",")}° ${pos.latDeg >= 0 ? "N" : "S"}, ` +
        `${Math.abs(pos.lonDeg).toFixed(2).replace(".", ",")}° ${pos.lonDeg >= 0 ? "O" : "W"}`;
      zeigeHinweis("Standort übernommen.");
      tick();
    } catch (e) {
      zeigeHinweis("Standort nicht verfügbar – es gilt weiterhin Essen.");
    }
  });

  el.infoSchliessen.addEventListener("click", schliesseInfo);
  el.fehlerSchliessen.addEventListener("click", () => { el.fehlerBanner.hidden = true; });

  window.addEventListener("resize", () => renderer.resize());
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

function versteckeStart() {
  el.startOverlay.hidden = true;
}

function bindeStart() {
  el.btnStartSensoren.addEventListener("click", async () => {
    versteckeStart();
    const ok = await controller.enableSensors(); // aus der User-Geste heraus
    aktualisiereModusButton();
    if (ok) zeigeHinweis("Handy an den Himmel halten – die Karte folgt deiner Blickrichtung.");
  });
  el.btnStartManuell.addEventListener("click", () => {
    versteckeStart();
    controller.setModeManual("start");
    zeigeHinweis("Wischen zum Schwenken, Pinch zum Zoomen, Antippen für Infos.");
  });
}

function registriereServiceWorker() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch((e) => {
        console.info("Service Worker nicht registriert:", e.message);
      });
    });
  }
}

function start() {
  ladeEinstellungen();
  bindeUi();
  bindeStart();
  registriereServiceWorker();
  aktualisiereKoerper();
  tick();
  setInterval(tick, 1000);
  requestAnimationFrame((t) => { letzterFrame = t; requestAnimationFrame(frame); });
  ladeDaten();

  // Testhook fuer Headless-Pruefung: Start-Overlay ueberspringen,
  // optional Blickrichtung/FOV vorgeben (?autostart=1&az=250&alt=30&fov=80).
  const params = new URLSearchParams(location.search);
  if (params.get("autostart")) {
    versteckeStart();
    controller.setModeManual("autostart");
    const az = parseFloat(params.get("az"));
    const alt = parseFloat(params.get("alt"));
    if (Number.isFinite(az) || Number.isFinite(alt)) {
      controller.lookAt(Number.isFinite(az) ? az : 180, Number.isFinite(alt) ? alt : 25);
    }
    const fov = parseFloat(params.get("fov"));
    if (Number.isFinite(fov)) controller.view.fovDeg = Math.max(20, Math.min(100, fov));
  }

  if (renderer.mode === "canvas2d") {
    console.info("WebGL nicht verfuegbar – Canvas-2D-Fallback aktiv.");
  }

  // Debug-Zugriff fuer Tests
  window.__sternenkompass = { state, renderer, controller };
}

start();
