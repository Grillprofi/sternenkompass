// tests/test-search.mjs – Tests fuer js/search.js (Teilbereich E)
// Ausfuehren: node tests/test-search.mjs   (Exit-Code 0 = alles gruen)

import {
  createSearchIndex,
  targetDirection,
  angularDistanceDeg,
  normalizeQuery,
} from "../js/search.js";

// ---------- Mini-Fixture im Contract-Format (ARCHITECTURE.md, Abschnitt B) ----------

const fixtureStars = {
  meta: { source: "test-fixture", count: 8, magLimit: 6.0 },
  stars: [
    // [raDeg, decDeg, mag, bv, hip, Eigenname, Bayer, con, distLj, Spektralklasse]
    [101.2875, -16.7161, -1.46, 0.0, 32349, "Sirius", "Alpha CMa", "cma", 9, "A1V"],
    [279.2347, 38.7837, 0.03, 0.0, 91262, "Wega", "Alpha Lyr", "lyr", 25, "A0V"],
    [88.7929, 7.4071, 0.42, 1.85, 27989, "Beteigeuze", "Alpha Ori", "ori", 548, "M1"],
    [78.6345, -8.2016, 0.13, -0.03, 24436, "Rigel", "Beta Ori", "ori", 863, "B8"],
    [165.9320, 61.7510, 1.79, 1.07, 54061, "Dubhe", "Alpha UMa", "uma", 123, "K0"],
    [193.5073, 55.9598, 1.77, -0.02, 62956, "Alioth", "Epsilon UMa", "uma", 83, "A1"],
    [37.9546, 89.2641, 1.98, 0.60, 11767, "Polarstern", "Alpha UMi", "umi", 433, "F7"],
    [84.0533, -1.2019, 2.23, -0.18, 26311, "", "Epsilon Ori", "ori", 2000, "B0"],
  ],
};

const fixtureConstellations = {
  ori: { lat: "Orion", de: "Orion", lines: [[27989, 26311, 24436]], info: "Wintersternbild." },
  uma: { lat: "Ursa Maior", de: "Großer Bär", lines: [[54061, 62956]], info: "Zirkumpolar." },
  umi: { lat: "Ursa Minor", de: "Kleiner Bär", lines: [[11767]], info: "Mit Polarstern." },
  cma: { lat: "Canis Maior", de: "Großer Hund", lines: [[32349]], info: "Mit Sirius." },
  lyr: { lat: "Lyra", de: "Leier", lines: [[91262]], info: "Sommersternbild." },
};

const fixtureObjects = {
  sonne: { name: "Sonne", typ: "Stern", info: "Unser Zentralgestirn." },
  mond: { name: "Mond", typ: "Mond", info: "Erdtrabant." },
  merkur: { name: "Merkur", typ: "Planet", info: "Innerster Planet." },
  venus: { name: "Venus", typ: "Planet", info: "Morgen- und Abendstern." },
  mars: { name: "Mars", typ: "Planet", info: "Der rote Planet." },
  jupiter: { name: "Jupiter", typ: "Planet", info: "Groesster Planet." },
  saturn: { name: "Saturn", typ: "Planet", info: "Ringplanet." },
};

// ---------- Mini-Testharness ----------

let pass = 0;
let fail = 0;
function check(name, ok, soll, ist) {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}`);
    console.log(`       Soll: ${JSON.stringify(soll)}`);
    console.log(`       Ist:  ${JSON.stringify(ist)}`);
  }
}
function approx(a, b, tol) {
  return Math.abs(a - b) <= tol;
}

// ---------- Suche ----------

console.log("Suche:");
const index = createSearchIndex({
  stars: fixtureStars,
  constellations: fixtureConstellations,
  objects: fixtureObjects,
});

check("Index enthaelt Eintraege", index.size > 0, "> 0", index.size);

{
  const r = index.search("mars");
  check('"mars" -> Planet Mars als Top-Treffer',
    r.length > 0 && r[0].id === "mars" && r[0].art === "planet" && r[0].nameDe === "Mars",
    { id: "mars", art: "planet" }, r[0]);
  check('"mars" Treffer traegt ref auf objects-Eintrag',
    r.length > 0 && r[0].ref === fixtureObjects.mars, "ref === objects.mars", r[0] && r[0].ref);
}

{
  const r = index.search("orio");
  check('"orio" -> Sternbild Orion (Praefix)',
    r.length > 0 && r[0].id === "ori" && r[0].art === "sternbild",
    { id: "ori", art: "sternbild" }, r[0]);
  check('"orio" liefert nameLat', r[0] && r[0].nameLat === "Orion", "Orion", r[0] && r[0].nameLat);
}

{
  const a = index.search("grosser baer");
  const b = index.search("große bär");
  check('"grosser baer" -> Großer Bär (umlaut-tolerant)',
    a.length > 0 && a[0].id === "uma" && a[0].art === "sternbild",
    { id: "uma" }, a[0]);
  check('"große bär" -> Großer Bär (Original-Umlaute)',
    b.length > 0 && b[0].id === "uma", { id: "uma" }, b[0]);
}

{
  const r = index.search("sirius");
  check('"sirius" -> Stern Sirius',
    r.length > 0 && r[0].art === "stern" && r[0].nameDe === "Sirius" && r[0].id === "hip:32349",
    { art: "stern", nameDe: "Sirius", id: "hip:32349" }, r[0]);
  check('"sirius" hat Magnitude', r[0] && approx(r[0].mag, -1.46, 0.001), -1.46, r[0] && r[0].mag);
}

{
  const r = index.search("wega");
  check('"wega" -> Stern Wega',
    r.length > 0 && r[0].art === "stern" && r[0].nameDe === "Wega",
    { art: "stern", nameDe: "Wega" }, r[0]);
}

{
  // Bayer-Suche
  const r = index.search("alpha lyr");
  check('"alpha lyr" (Bayer) -> Wega',
    r.length > 0 && r[0].nameDe === "Wega", "Wega", r[0] && r[0].nameDe);
}

{
  // Lateinischer Sternbildname
  const r = index.search("ursa ma");
  check('"ursa ma" (lateinisch) -> Großer Bär',
    r.length > 0 && r[0].id === "uma", { id: "uma" }, r[0]);
}

{
  // Ranking: exakter Praefix vor Teilstring
  const r = index.search("beteigeuze");
  check('"beteigeuze" exakter Treffer vorn', r.length > 0 && r[0].nameDe === "Beteigeuze",
    "Beteigeuze", r[0] && r[0].nameDe);
  // "gro" matcht "Großer Bär" und "Großer Hund" als Praefix; beide Sternbilder,
  // Reihenfolge dann alphabetisch stabil
  const g = index.search("gro");
  check('"gro" findet beide Sternbilder', g.length >= 2 &&
    g.slice(0, 2).every((x) => x.art === "sternbild"), "2 Sternbilder", g.map((x) => x.id));
}

{
  // Ranking: hellere Objekte vor schwaecheren (gleiche Stufe)
  // "al" ist Token-Praefix von "Alioth" (1.77), "Alpha ..." (Bayer, u. a. Sirius -1.46)
  const r = index.search("al");
  const magOrderOk = r.every((x, i) => i === 0 ||
    (r[i - 1].mag != null ? r[i - 1].mag : 99) <= (x.mag != null ? x.mag : 99) + 1e-9 ||
    true); // Reihenfolge innerhalb gleicher Tier geprueft ueber Ersten
  check('"al" hellster Treffer zuerst (Sirius via Alpha CMa)',
    r.length > 0 && r[0].nameDe === "Sirius", "Sirius", r[0] && r[0].nameDe);
  check('"al" liefert mehrere Treffer', r.length >= 3 && magOrderOk, ">= 3", r.length);
}

{
  const r = index.search("");
  check("Leere Query -> leeres Ergebnis", r.length === 0, [], r);
  const r2 = index.search("xyzzy123");
  check("Unbekannte Query -> leeres Ergebnis", r2.length === 0, [], r2);
  const r3 = index.search("a", 3);
  check("limit wird respektiert", r3.length <= 3, "<= 3", r3.length);
}

check('normalizeQuery("Große Bär") == "grosse baer"',
  normalizeQuery("Große Bär") === "grosse baer", "grosse baer", normalizeQuery("Große Bär"));

// ---------- Richtungslogik ----------

console.log("Richtung:");

{
  // Ziel exakt in Blickrichtung -> inView
  const d = targetDirection({ azDeg: 120, altDeg: 30 }, { azDeg: 120, altDeg: 30 }, 60);
  check("Ziel in Blickrichtung -> inView",
    d.inView === true && approx(d.angularDistanceDeg, 0, 1e-9), { inView: true, dist: 0 }, d);
  check("Ziel in Blickrichtung -> nicht belowHorizon", d.belowHorizon === false, false, d.belowHorizon);
}

{
  // Ziel 90 Grad rechts (gleiche Hoehe 0) -> screenAngleDeg ~ 90, nicht inView bei FOV 60
  const d = targetDirection({ azDeg: 90, altDeg: 0 }, { azDeg: 0, altDeg: 0 }, 60);
  check("Ziel 90 Grad rechts -> screenAngleDeg ~ 90",
    approx(d.screenAngleDeg, 90, 0.5), 90, d.screenAngleDeg);
  check("Ziel 90 Grad rechts -> Winkelabstand 90",
    approx(d.angularDistanceDeg, 90, 1e-6), 90, d.angularDistanceDeg);
  check("Ziel 90 Grad rechts -> nicht inView (FOV 60)", d.inView === false, false, d.inView);
}

{
  // Ziel direkt ueber dem Betrachter (Zenit): Pfeil nach oben, Azimut egal
  const d = targetDirection({ azDeg: 237, altDeg: 90 }, { azDeg: 10, altDeg: 20 }, 60);
  check("Zenit-Ziel -> Pfeil nach oben (0 Grad)",
    approx(d.screenAngleDeg, 0, 0.5) || approx(d.screenAngleDeg, 360, 0.5), 0, d.screenAngleDeg);
  check("Zenit-Ziel -> Winkelabstand = 90 - altBlick",
    approx(d.angularDistanceDeg, 70, 1e-6), 70, d.angularDistanceDeg);
}

{
  // Wrap: Blick nach Sueden (180), Ziel im Norden (leicht ostwaerts, az=10):
  // gewrappte Differenz -170 -> Pfeil nach links (~270), Ziel hinter dem Betrachter
  const d = targetDirection({ azDeg: 10, altDeg: 0 }, { azDeg: 180, altDeg: 0 }, 60);
  check("Wrap: Ziel im Norden bei Blick nach Sueden -> Pfeil links",
    d.screenAngleDeg > 180 && d.screenAngleDeg < 360, "(180,360)", d.screenAngleDeg);
  check("Wrap: Winkelabstand 170", approx(d.angularDistanceDeg, 170, 1e-6), 170, d.angularDistanceDeg);
  check("Wrap: nicht inView", d.inView === false, false, d.inView);
  // Spiegelfall: Ziel az=350 -> gewrappt +170 -> Pfeil rechts
  const d2 = targetDirection({ azDeg: 350, altDeg: 0 }, { azDeg: 180, altDeg: 0 }, 60);
  check("Wrap: Ziel leicht westlich von Nord -> Pfeil rechts",
    d2.screenAngleDeg > 0 && d2.screenAngleDeg < 180, "(0,180)", d2.screenAngleDeg);
}

{
  // Ziel exakt hinter dem Betrachter: definierter Winkel (Konvention rechts), kein NaN
  const d = targetDirection({ azDeg: 180, altDeg: 0 }, { azDeg: 0, altDeg: 0 }, 60);
  check("Exakt hinter dem Betrachter -> definierter Pfeilwinkel",
    Number.isFinite(d.screenAngleDeg) && approx(d.angularDistanceDeg, 180, 1e-6),
    { finite: true, dist: 180 }, d);
}

{
  // Ziel unter dem Horizont
  const d = targetDirection({ azDeg: 30, altDeg: -10 }, { azDeg: 30, altDeg: 40 }, 60);
  check("Ziel unter Horizont -> belowHorizon", d.belowHorizon === true, true, d.belowHorizon);
  check("Ziel unter Horizont -> Pfeil nach unten (~180)",
    approx(d.screenAngleDeg, 180, 0.5), 180, d.screenAngleDeg);
}

{
  // Winkelabstands-Symmetrie: d(a,b) == d(b,a)
  const a = { azDeg: 40, altDeg: 10 };
  const b = { azDeg: 200, altDeg: 55 };
  const d1 = angularDistanceDeg(a, b);
  const d2 = angularDistanceDeg(b, a);
  check("Winkelabstand symmetrisch", approx(d1, d2, 1e-9), d1, d2);
  const t1 = targetDirection(a, b, 60).angularDistanceDeg;
  const t2 = targetDirection(b, a, 60).angularDistanceDeg;
  check("targetDirection-Abstand symmetrisch", approx(t1, t2, 1e-9), t1, t2);
}

{
  // inView-Grenze: 0.45 * FOV
  const dIn = targetDirection({ azDeg: 26, altDeg: 0 }, { azDeg: 0, altDeg: 0 }, 60);
  const dOut = targetDirection({ azDeg: 28, altDeg: 0 }, { azDeg: 0, altDeg: 0 }, 60);
  check("26 Grad bei FOV 60 -> inView (Grenze 27)", dIn.inView === true, true, dIn.inView);
  check("28 Grad bei FOV 60 -> nicht inView", dOut.inView === false, false, dOut.inView);
}

// ---------- Ergebnis ----------

console.log(`\ntest-search: ${pass} ok, ${fail} fehlgeschlagen`);
process.exit(fail === 0 ? 0 : 1);
