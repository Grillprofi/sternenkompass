#!/usr/bin/env node
// tests/test-astro.mjs — Referenztests fuer js/astro.js (Teilbereich A, Sternenkompass)
//
// Aufruf:  cd "<app-Verzeichnis>" && node tests/test-astro.mjs
// Exit-Code 0 = alle Tests gruen, 1 = mindestens ein Fehlschlag.
// Ausgabe pro Testfall: Soll, Ist, Abweichung, Toleranz.
//
// Referenzquellen (im jeweiligen Block erneut genannt):
// [M12] Meeus, Astronomical Algorithms (2. Aufl.), Beispiele 12.a/12.b (Sternzeit)
// [M13] Meeus, Beispiel 13.b (Venus, US Naval Observatory, Koordinatentransformation)
// [M25] Meeus, Beispiel 25.a (Sonne 1992-10-13.0 TD)
// [M47] Meeus, Beispiel 47.a (Mond 1992-04-12.0 TD)
// [M48] Meeus, Beispiel 48.a (Beleuchteter Bruchteil des Mondes, gleiche Zeit wie 47.a)
// [M33] Meeus, Beispiel 33.a (Venus geozentrisch 1992-12-20.0 TD)
// [GK20] Grosse Konjunktion Jupiter–Saturn 2020-12-21, ~18:30 UT: minimale
//        Separation 6,1 Bogenminuten (~0,102 Grad), beide Planeten bei
//        RA ~20h11m (~302,7 Grad), Dec ~ -20,5 Grad im Steinbock; Helligkeiten
//        Jupiter ~ -2,0 mag, Saturn ~ +0,6 mag. Dokumentiert u. a. von NASA/JPL
//        ("The Great Conjunction of Jupiter and Saturn", Dez. 2020) und in den
//        JPL-Horizons-Ephemeriden, breit reproduziert in der Fachpresse.
// [SF26] Totale Sonnenfinsternis 2026-08-12, groesste Verfinsterung ~17:46 UT
//        (NASA Eclipse Catalog / Espenak, "Total Solar Eclipse of 2026 Aug 12";
//        Totalitaet u. a. in Spanien und Island). Sonnenfinsternis = Neumond:
//        Wenige Stunden spaeter (22:35 UT) muss der Mond fast unbeleuchtet
//        (Phasenwinkel nahe 180 Grad) und gerade wieder zunehmend sein.
// [CTR] ARCHITECTURE.md, Abschnitt A: Pflicht-Referenzfaelle Mars und Sonne
//        2026-08-12 22:35 UT fuer Essen (51.4556 N, 7.0116 O).
//
// Hinweis zu den Meeus-Beispielen: Die Buchbeispiele sind in Dynamischer Zeit
// (TD/JDE) angegeben. Die Engine bekommt hier das JDE direkt als jd uebergeben,
// d. h. die Reihen werden exakt am Zeitargument des Buchs ausgewertet.
// Delta-T (~59 s im Jahr 1992) ist bei den gepruefen Toleranzen vernachlaessigbar
// und wird von der Engine vertragsgemaess nicht modelliert.

import {
  jdFromDate,
  gmstDeg,
  raDecToAltAz,
  altAzToRaDec,
  refractionDeg,
  sunEquatorial,
  moonEquatorial,
  planetEquatorial,
  precessStarJ2000ToDate,
  PLANET_NAMES,
} from "../js/astro.js";

let total = 0;
let failed = 0;

const fmt = (x, n = 4) => Number(x).toFixed(n);

// Kleinste Winkeldifferenz (beruecksichtigt 0/360-Umbruch)
function angAbs(a, b) {
  let d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function report(ok, name, sollTxt, istTxt, abwTxt, tolTxt) {
  total++;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  console.log(`      Soll ${sollTxt} | Ist ${istTxt} | Abw ${abwTxt} | Toleranz ${tolTxt}`);
}

// Winkelvergleich in Grad (zirkular)
function checkAng(name, ist, soll, tol, digits = 4) {
  const abw = angAbs(ist, soll);
  report(abw <= tol, name, `${fmt(soll, digits)}°`, `${fmt(ist, digits)}°`, `${fmt(abw, digits)}°`, `±${tol}°`);
}

// Skalarer Vergleich mit absoluter Toleranz
function checkAbs(name, ist, soll, tol, unit = "", digits = 4) {
  const abw = Math.abs(ist - soll);
  report(abw <= tol, name, `${fmt(soll, digits)}${unit}`, `${fmt(ist, digits)}${unit}`, `${fmt(abw, digits)}${unit}`, `±${tol}${unit}`);
}

// Relativer Vergleich (z. B. Distanzen ±2 %)
function checkRel(name, ist, soll, relTol, unit = "", digits = 4) {
  const rel = Math.abs(ist - soll) / Math.abs(soll);
  report(rel <= relTol, name, `${fmt(soll, digits)}${unit}`, `${fmt(ist, digits)}${unit}`, `${fmt(rel * 100, 3)} %`, `±${fmt(relTol * 100, 1)} %`);
}

// Bereichs-/Wahrheitspruefung
function checkTrue(name, cond, sollTxt, istTxt) {
  report(!!cond, name, sollTxt, istTxt, cond ? "-" : "verletzt", "-");
}

// Winkelabstand zweier RA/Dec-Positionen (Grad)
function sepDeg(a, b) {
  const d2r = Math.PI / 180;
  const c =
    Math.sin(a.decDeg * d2r) * Math.sin(b.decDeg * d2r) +
    Math.cos(a.decDeg * d2r) * Math.cos(b.decDeg * d2r) * Math.cos((a.raDeg - b.raDeg) * d2r);
  return Math.acos(Math.min(1, Math.max(-1, c))) / d2r;
}

console.log("=== Sternenkompass: Tests Astronomie-Engine (js/astro.js) ===\n");

// ---------------------------------------------------------------------------
console.log("-- 1. Julianisches Datum --");
// Definitionstests: J2000.0 = 2451545.0 (2000-01-01 12:00 UT),
// Unix-Epoche = 2440587.5, Meeus 12.a-Datum 1987-04-10 0h UT = 2446895.5.
checkAbs("JD 2000-01-01 12:00 UT (J2000.0)", jdFromDate(new Date(Date.UTC(2000, 0, 1, 12, 0, 0))), 2451545.0, 1e-6, " d", 6);
checkAbs("JD 1970-01-01 00:00 UT (Unix-Epoche)", jdFromDate(new Date(Date.UTC(1970, 0, 1, 0, 0, 0))), 2440587.5, 1e-6, " d", 6);
checkAbs("JD 1987-04-10 00:00 UT [M12]", jdFromDate(new Date(Date.UTC(1987, 3, 10, 0, 0, 0))), 2446895.5, 1e-6, " d", 6);

// ---------------------------------------------------------------------------
console.log("\n-- 2. Sternzeit (GMST) --");
// [M12] Beispiel 12.a: 1987-04-10 0h UT -> mittlere GMST 13h10m46.3668s = 197.693195 Grad.
// [M12] Beispiel 12.b: 1987-04-10 19:21:00 UT -> mittlere GMST 8h34m57.0896s = 128.737873 Grad.
checkAng("GMST 1987-04-10 00:00 UT [M12 12.a]", gmstDeg(2446895.5), 197.693195, 0.0005, 6);
checkAng("GMST 1987-04-10 19:21 UT [M12 12.b]", gmstDeg(2446896.30625), 128.737873, 0.0005, 6);

// ---------------------------------------------------------------------------
console.log("\n-- 3. RA/Dec <-> Az/Alt --");
// [M13] Beispiel 13.b: Venus am 1987-04-10 19:21 UT vom US Naval Observatory
// (Breite +38.92139, Laenge 77.06556 West -> Ost-positiv: -77.06556):
// scheinbare alpha = 347.3193, delta = -6.71989 -> H = 64.352133,
// Azimut ab Sued A = 68.0337 (ab Nord: 248.0337), Hoehe h = 15.1249 (geometrisch).
// Meeus rechnet mit scheinbarer Sternzeit; die Engine nutzt mittlere GMST,
// Unterschied hier < 0.004 Grad.
const obsUSNO = { latDeg: 38.92139, lonDeg: -77.06556 };
const jd13b = 2446896.30625;
const aa13b = raDecToAltAz(347.3193, -6.71989, jd13b, obsUSNO);
checkAng("Venus USNO Azimut (0=Nord) [M13]", aa13b.azDeg, 248.0337, 0.02);
checkAbs("Venus USNO Hoehe [M13]", aa13b.altDeg, 15.1249, 0.02, "°");
// Rueckrichtung mit den Meeus-Sollwerten:
const rd13b = altAzToRaDec(248.0337, 15.1249, jd13b, obsUSNO);
checkAng("Rueckrechnung RA [M13]", rd13b.raDeg, 347.3193, 0.02);
checkAbs("Rueckrechnung Dec [M13]", rd13b.decDeg, -6.71989, 0.02, "°");
// Selbstkonsistenz: altAzToRaDec(raDecToAltAz(x)) == x (mehrere Richtungen)
{
  const obs = { latDeg: 51.4556, lonDeg: 7.0116 };
  const jd = 2461265.4409722;
  let maxErr = 0;
  for (const [az, alt] of [[10, 5], [123.4, 42], [250, -30], [359, 80], [180, 0.5]]) {
    const rd = altAzToRaDec(az, alt, jd, obs);
    const aa = raDecToAltAz(rd.raDeg, rd.decDeg, jd, obs);
    maxErr = Math.max(maxErr, angAbs(aa.azDeg, az), Math.abs(aa.altDeg - alt));
  }
  checkAbs("Roundtrip az/alt -> ra/dec -> az/alt (max. Fehler)", maxErr, 0, 1e-9, "°", 12);
}

// ---------------------------------------------------------------------------
console.log("\n-- 4. Refraktion (Saemundsson) --");
// Meeus Kap. 16, Formel 16.4: R(0 Grad) ~ 28.9' = 0.483 Grad, R(45 Grad) ~ 1.0' = 0.017 Grad.
checkAbs("Refraktion bei 0 Grad Hoehe", refractionDeg(0), 0.483, 0.05, "°");
checkAbs("Refraktion bei 45 Grad Hoehe", refractionDeg(45), 0.0169, 0.005, "°");
checkTrue("Refraktion bei 90 Grad ~ 0 und nie negativ",
  refractionDeg(90) >= 0 && refractionDeg(90) < 0.01 && refractionDeg(-1.5) >= 0,
  "0 <= R(90) < 0.01", `R(90)=${fmt(refractionDeg(90), 5)}°`);

// ---------------------------------------------------------------------------
console.log("\n-- 5. Sonne --");
// [M25] Beispiel 25.a: 1992-10-13.0 TD (JDE 2448908.5):
// scheinbare alpha = 198.38083, delta = -7.78507, R = 0.99766 AE.
{
  const s = sunEquatorial(2448908.5);
  checkAng("Sonne 1992-10-13 RA [M25]", s.raDeg, 198.38083, 0.02);
  checkAbs("Sonne 1992-10-13 Dec [M25]", s.decDeg, -7.78507, 0.02, "°");
  checkRel("Sonne 1992-10-13 Distanz [M25]", s.distAU, 0.99766, 0.005, " AE", 5);
}

// [CTR] Sonne 2026-08-12 22:35 UT, Essen: Az 344.2, Alt -22.4 (geometrisch),
// RA 142.3 Grad, Dec +14.85. Toleranz laut Contract ±0.5 Grad.
const obsEssen = { latDeg: 51.4556, lonDeg: 7.0116 };
const jdCtr = jdFromDate(new Date(Date.UTC(2026, 7, 12, 22, 35, 0)));
{
  checkAbs("JD Kontrollwert 2026-08-12 22:35 UT", jdCtr, 2461265.4409722, 1e-6, " d", 7);
  const s = sunEquatorial(jdCtr);
  const aa = raDecToAltAz(s.raDeg, s.decDeg, jdCtr, obsEssen);
  checkAng("Sonne 2026-08-12 RA [CTR]", s.raDeg, 142.3, 0.5, 3);
  checkAbs("Sonne 2026-08-12 Dec [CTR]", s.decDeg, 14.85, 0.5, "°", 3);
  checkAng("Sonne 2026-08-12 Azimut [CTR]", aa.azDeg, 344.2, 0.5, 3);
  checkAbs("Sonne 2026-08-12 Hoehe [CTR]", aa.altDeg, -22.4, 0.5, "°", 3);
}

// ---------------------------------------------------------------------------
console.log("\n-- 6. Mond --");
// [M47] Beispiel 47.a: 1992-04-12.0 TD (JDE 2448724.5):
// lambda = 133.162655, beta = -3.229126, Delta = 368409.7 km,
// scheinbare alpha = 134.688470, delta = 13.768368.
// [M48] Beispiel 48.a (gleiche Zeit): Phasenwinkel i = 69.08, k = 0.6786.
// Der Mond stand ~9 Tage nach Neumond (28.03.) -> zunehmend.
{
  const m = moonEquatorial(2448724.5);
  checkAng("Mond 1992-04-12 RA [M47]", m.raDeg, 134.68847, 0.05);
  checkAbs("Mond 1992-04-12 Dec [M47]", m.decDeg, 13.768368, 0.05, "°");
  checkRel("Mond 1992-04-12 Distanz [M47]", m.distKm, 368409.7, 0.005, " km", 1);
  checkAbs("Mond 1992-04-12 Phasenwinkel [M48]", m.phaseAngleDeg, 69.08, 1.0, "°", 3);
  checkAbs("Mond 1992-04-12 beleuchteter Anteil [M48]", m.illumFraction, 0.6786, 0.02, "", 4);
  checkTrue("Mond 1992-04-12 zunehmend [M48]", m.isWaxing === true, "isWaxing=true", `isWaxing=${m.isWaxing}`);
}

// [SF26] Neumond-Probe: Am 2026-08-12 um 17:46 UT war totale Sonnenfinsternis
// (= Neumond). Um 22:35 UT (Contract-Zeitpunkt, ~4.8 h danach) muss gelten:
// beleuchteter Anteil nahe 0, Phasenwinkel nahe 180 Grad, wieder zunehmend.
{
  const m = moonEquatorial(jdFromDate(new Date(Date.UTC(2026, 7, 12, 22, 35, 0))));
  checkTrue("Mond 2026-08-12 22:35 UT fast unbeleuchtet [SF26]",
    m.illumFraction >= 0 && m.illumFraction < 0.005, "0 <= k < 0.005", `k=${fmt(m.illumFraction, 5)}`);
  checkAbs("Mond 2026-08-12 Phasenwinkel nahe Neumond [SF26]", m.phaseAngleDeg, 180, 6, "°", 2);
  checkTrue("Mond 2026-08-12 nach der Finsternis zunehmend [SF26]",
    m.isWaxing === true, "isWaxing=true", `isWaxing=${m.isWaxing}`);
}

// ---------------------------------------------------------------------------
console.log("\n-- 7. Planeten --");
// [M33] Beispiel 33.a: Venus 1992-12-20.0 TD (JDE 2448976.5):
// scheinbare alpha = 316.172725 (21h04m41.454s), delta = -18.888011
// (-18 Grad 53' 16.84"), Distanz nach Lichtlaufzeit 0.910845 AE.
// (Buchwert via VSOP87; Keplerelemente + fehlende Aberration kosten wenige
// Hundertstel Grad, deshalb Toleranz 0.3 Grad < Zielgenauigkeit-Nachweis.)
{
  const v = planetEquatorial("venus", 2448976.5);
  checkAng("Venus 1992-12-20 RA [M33]", v.raDeg, 316.172725, 0.3);
  checkAbs("Venus 1992-12-20 Dec [M33]", v.decDeg, -18.888011, 0.3, "°");
  checkRel("Venus 1992-12-20 Distanz [M33]", v.distAU, 0.910845, 0.02, " AE", 6);
  checkTrue("Venus 1992-12-20 Magnitude plausibel (-5.0 .. -3.5)",
    v.magnitude > -5.0 && v.magnitude < -3.5, "-5.0 < m < -3.5", `m=${fmt(v.magnitude, 2)}`);
}

// [CTR] Mars 2026-08-12 22:35 UT, Essen: Az 33.3, Alt -8.3 (geometrisch),
// RA 6.05 h = 90.75 Grad, Dec +23.7, Distanz 1.945 AE. Toleranz ±0.5 Grad / ±2 %.
{
  const m = planetEquatorial("mars", jdCtr);
  const aa = raDecToAltAz(m.raDeg, m.decDeg, jdCtr, obsEssen);
  checkAng("Mars 2026-08-12 RA [CTR]", m.raDeg, 90.75, 0.5, 3);
  checkAbs("Mars 2026-08-12 Dec [CTR]", m.decDeg, 23.7, 0.5, "°", 3);
  checkAng("Mars 2026-08-12 Azimut [CTR]", aa.azDeg, 33.3, 0.5, 3);
  checkAbs("Mars 2026-08-12 Hoehe [CTR]", aa.altDeg, -8.3, 0.5, "°", 3);
  checkRel("Mars 2026-08-12 Distanz [CTR]", m.distAU, 1.945, 0.02, " AE", 4);
  checkTrue("Mars 2026-08-12 Magnitude plausibel (+0.5 .. +2.0)",
    m.magnitude > 0.5 && m.magnitude < 2.0, "0.5 < m < 2.0", `m=${fmt(m.magnitude, 2)}`);
}

// [GK20] Grosse Konjunktion 2020-12-21 ~18:30 UT (geozentrisch):
// Jupiter und Saturn nur 6.1' (~0.102 Grad) getrennt, beide bei
// RA ~302.7 Grad (20h11m), Dec ~ -20.5 Grad. Quellen: NASA/JPL-Mitteilungen zur
// Grossen Konjunktion Dez. 2020; JPL Horizons. Da die Modellfehler beider
// Planeten (Standish 1800-2050: Jupiter ~0.11 Grad, Saturn ~0.17 Grad max.)
// nicht korrelieren muessen, wird die Separation gegen 0.45 Grad geprueft.
{
  const jdGK = jdFromDate(new Date(Date.UTC(2020, 11, 21, 18, 30, 0)));
  const j = planetEquatorial("jupiter", jdGK);
  const s = planetEquatorial("saturn", jdGK);
  const sep = sepDeg(j, s);
  checkAbs("Jupiter/Saturn Separation 2020-12-21 [GK20]", sep, 0.102, 0.35, "°", 3);
  checkAng("Jupiter 2020-12-21 RA [GK20]", j.raDeg, 302.7, 0.7, 3);
  checkAbs("Jupiter 2020-12-21 Dec [GK20]", j.decDeg, -20.5, 0.7, "°", 3);
  checkAng("Saturn 2020-12-21 RA [GK20]", s.raDeg, 302.7, 0.7, 3);
  checkAbs("Saturn 2020-12-21 Dec [GK20]", s.decDeg, -20.5, 0.7, "°", 3);
  checkTrue("Jupiter 2020-12-21 Magnitude plausibel (-2.6 .. -1.4)",
    j.magnitude > -2.6 && j.magnitude < -1.4, "-2.6 < m < -1.4", `m=${fmt(j.magnitude, 2)}`);
  checkTrue("Saturn 2020-12-21 Magnitude plausibel (0.0 .. +1.3)",
    s.magnitude > 0.0 && s.magnitude < 1.3, "0.0 < m < 1.3", `m=${fmt(s.magnitude, 2)}`);
}

// ---------------------------------------------------------------------------
console.log("\n-- 8. API-Vollstaendigkeit --");
checkTrue("PLANET_NAMES vollstaendig und in Contract-Reihenfolge",
  JSON.stringify(PLANET_NAMES) === JSON.stringify(["merkur", "venus", "mars", "jupiter", "saturn", "uranus", "neptun"]),
  '["merkur",...,"neptun"]', JSON.stringify(PLANET_NAMES));
{
  let ok = true;
  let detail = "";
  for (const name of PLANET_NAMES) {
    const p = planetEquatorial(name, jdCtr);
    const fin = Number.isFinite(p.raDeg) && Number.isFinite(p.decDeg) &&
      Number.isFinite(p.distAU) && Number.isFinite(p.magnitude) && p.distAU > 0.1;
    if (!fin) { ok = false; detail += ` ${name}!`; }
  }
  checkTrue("Alle Planeten liefern endliche Werte (2026-08-12)", ok, "alle endlich", ok ? "alle endlich" : detail);
  let threw = false;
  try { planetEquatorial("pluto", jdCtr); } catch { threw = true; }
  checkTrue("Unbekannter Planet wirft Fehler", threw, "Error", threw ? "Error" : "kein Error");
}

// ---------------------------------------------------------------------------
console.log("\n-- 9. Praezession J2000 -> Datum (precessStarJ2000ToDate) --");
// Invariantentests ohne externe Referenz plus Groessenordnungspruefung Polaris:
// (a) T=0 (J2000.0) muss die Eingabe unveraendert lassen.
// (b) Polaris (J2000: RA 37.9546, Dec +89.2641) naehert sich bis ~2100 dem
//     Himmelspol; 2026 muss Dec zwischen +89.30 und +89.40 liegen und die
//     Gesamtverschiebung gegenueber J2000 in der Groessenordnung 0.1 Grad.
// (c) Sirius: Praezession verschiebt um ~0.36 Grad in 26 Jahren (50.3"/Jahr
//     entlang der Ekliptik), die Verschiebung muss zwischen 0.2 und 0.5 Grad
//     liegen.
{
  const pJ2000 = precessStarJ2000ToDate(37.9546, 89.2641, 2451545.0);
  checkAng("Praezession bei J2000.0: RA unveraendert", pJ2000.raDeg, 37.9546, 1e-9, 6);
  checkAng("Praezession bei J2000.0: Dec unveraendert", pJ2000.decDeg, 89.2641, 1e-9, 6);

  const pol = precessStarJ2000ToDate(37.9546, 89.2641, jdCtr);
  checkTrue("Polaris 2026: Dec in (+89.30, +89.40)", pol.decDeg > 89.30 && pol.decDeg < 89.40,
    "+89.30 < Dec < +89.40", `${fmt(pol.decDeg)}°`);

  const sirius = { raDeg: 101.2872, decDeg: -16.7161 };
  const sir26 = precessStarJ2000ToDate(sirius.raDeg, sirius.decDeg, jdCtr);
  const shift = sepDeg(sirius, sir26);
  checkTrue("Sirius 2026: Praezessionsverschiebung in (0.2, 0.5) Grad", shift > 0.2 && shift < 0.5,
    "0.2° < Abstand < 0.5°", `${fmt(shift)}°`);
}

// ---------------------------------------------------------------------------
console.log(`\n=== Ergebnis: ${total - failed}/${total} Tests bestanden, ${failed} Fehlschlaege ===`);
process.exit(failed > 0 ? 1 : 0);
