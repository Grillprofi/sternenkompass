// js/search.js – Teilbereich E: Objektsuche + Richtungspfeil (Sternenkompass)
//
// Öffentliche API:
//
//   createSearchIndex({ stars, constellations, objects }) -> { search(query, limit=8), size }
//     - stars: geparstes stars.json ({ meta, stars } oder direkt das Array der Sternzeilen
//       [raDeg, decDeg, mag, bv, hip, eigenname, bayer, conKürzel, distLj, spektral])
//     - constellations: geparstes constellations.json ({ "ori": { lat, de, lines, info }, ... })
//     - objects: geparstes objects.json ({ "sonne": { name, typ, info }, ... })
//     - search(query, limit) liefert Array von
//       { id, art: "planet"|"stern"|"sternbild"|"sonne"|"mond", nameDe, nameLat?, mag?, ref }
//       Toleranz: case-insensitiv, umlaut-tolerant (ae=ä, oe=ö, ue=ü, ss=ß, Akzente entfernt),
//       Präfix- und Teilstringsuche, tokenweise ("grosser baer" findet "Großer Bär").
//       Ranking: exakter Präfixtreffer < Token-Präfix < Teilstring; innerhalb einer Stufe
//       hellere Objekte (kleinere Magnitude) zuerst.
//
//   targetDirection(targetAltAz, viewAltAz, fovDeg)
//     -> { inView, screenAngleDeg, angularDistanceDeg, belowHorizon }
//     - targetAltAz / viewAltAz: { azDeg, altDeg } (Azimut 0=N, 90=O, Grad; Contract-Konvention)
//     - inView: wahrer Winkelabstand (Großkreis) < 0.45 * fovDeg
//     - screenAngleDeg: Pfeilrichtung am Bildschirmrand, 0 = oben, 90 = rechts, im
//       Uhrzeigersinn [0,360). Kleinwinkelprojektion um die Blickrichtung:
//       x = wrap180(dAz) * cos(altZiel), y = dAlt. cos(altZiel) macht den Zenitfall
//       sauber (Azimut dort bedeutungslos -> Pfeil zeigt nach oben).
//       Ziel hinter dem Betrachter: Pfeil zeigt über die kürzere Seite (Vorzeichen des
//       gewrappten dAz), bei exakt 180 Grad Differenz konventionell nach rechts.
//     - belowHorizon: targetAltAz.altDeg < 0 (Flag, unabhängig von inView; ein Blick
//       unter den Horizont ist im Manuell-Modus möglich).
//
// Keine Dependencies, kein fetch, kein DOM: lauffähig unter Node 22 und im Browser.

const DEG = Math.PI / 180;

// Typische (mittlere) Magnituden fuer Ranking-Zwecke; echte Live-Magnituden liefert
// astro.js zur Laufzeit, fuer die Suche reicht die Groessenordnung.
const DEFAULT_MAGS = {
  sonne: -26.7,
  mond: -12.7,
  venus: -4.1,
  jupiter: -2.2,
  mars: -0.7,
  merkur: 0.2,
  saturn: 0.6,
  uranus: 5.7,
  neptun: 7.9,
};

const CONSTELLATION_RANK_MAG = 2.0; // Sternbilder haben keine Magnitude; feste Ranghelligkeit

// "Große Bär" -> "grosse baer"; entfernt zusätzlich Akzente und Sonderzeichen.
export function normalizeQuery(s) {
  return String(s == null ? "" : s)
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function starsArray(stars) {
  if (Array.isArray(stars)) return stars;
  if (stars && Array.isArray(stars.stars)) return stars.stars;
  return [];
}

// Match-Stufen: 0 = ganzer Name beginnt mit der Query, 1 = jedes Query-Token ist
// Präfix eines Namens-Tokens, 2 = Query als zusammenhängender Teilstring,
// 3 = jedes Query-Token irgendwo enthalten, -1 = kein Treffer.
function matchTier(queryNorm, nameNorm) {
  if (!queryNorm || !nameNorm) return -1;
  if (nameNorm.startsWith(queryNorm)) return 0;
  const qTokens = queryNorm.split(" ");
  const nTokens = nameNorm.split(" ");
  if (qTokens.every((qt) => nTokens.some((nt) => nt.startsWith(qt)))) return 1;
  if (nameNorm.includes(queryNorm)) return 2;
  if (qTokens.every((qt) => nameNorm.includes(qt))) return 3;
  return -1;
}

export function createSearchIndex({ stars, constellations, objects } = {}) {
  const entries = [];

  // 1) Sonne/Mond/Planeten aus objects.json (deutsche Namen)
  for (const [key, obj] of Object.entries(objects || {})) {
    if (!obj || typeof obj !== "object") continue;
    let art;
    if (key === "sonne") art = "sonne";
    else if (key === "mond") art = "mond";
    else if (obj.typ === "Planet" || key in DEFAULT_MAGS) art = "planet";
    else continue; // andere Objekttypen sind nicht Teil des Suchcontracts
    const nameDe = obj.name || key;
    entries.push({
      result: {
        id: key,
        art,
        nameDe,
        mag: DEFAULT_MAGS[key],
        ref: obj,
      },
      names: [normalizeQuery(nameDe), normalizeQuery(key)],
      rankMag: DEFAULT_MAGS[key] != null ? DEFAULT_MAGS[key] : 1.0,
    });
  }

  // 2) Sternbilder (deutsch UND lateinisch)
  for (const [code, con] of Object.entries(constellations || {})) {
    if (!con || typeof con !== "object") continue;
    const nameDe = con.de || con.lat || code;
    entries.push({
      result: {
        id: code,
        art: "sternbild",
        nameDe,
        nameLat: con.lat || undefined,
        ref: con,
      },
      names: [normalizeQuery(nameDe), normalizeQuery(con.lat || "")],
      rankMag: CONSTELLATION_RANK_MAG,
    });
  }

  // 3) Benannte Sterne (Eigenname und/oder Bayer-Bezeichnung)
  for (const row of starsArray(stars)) {
    if (!Array.isArray(row)) continue;
    const mag = typeof row[2] === "number" ? row[2] : undefined;
    const hip = row[4];
    const eigenname = typeof row[5] === "string" ? row[5].trim() : "";
    const bayer = typeof row[6] === "string" ? row[6].trim() : "";
    if (!eigenname && !bayer) continue; // unbenannte Sterne sind nicht suchbar
    const nameDe = eigenname || bayer;
    entries.push({
      result: {
        id: hip ? "hip:" + hip : "star:" + normalizeQuery(nameDe).replace(/ /g, "-"),
        art: "stern",
        nameDe,
        nameLat: bayer || undefined,
        mag,
        ref: row,
      },
      names: [normalizeQuery(eigenname), normalizeQuery(bayer)].filter(Boolean),
      rankMag: mag != null ? mag : 6.0,
    });
  }

  function search(query, limit = 8) {
    const q = normalizeQuery(query);
    if (!q) return [];
    const hits = [];
    for (const e of entries) {
      let best = -1;
      for (const name of e.names) {
        const tier = matchTier(q, name);
        if (tier >= 0 && (best === -1 || tier < best)) best = tier;
        if (best === 0) break;
      }
      if (best >= 0) hits.push({ tier: best, entry: e });
    }
    hits.sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      if (a.entry.rankMag !== b.entry.rankMag) return a.entry.rankMag - b.entry.rankMag;
      return a.entry.result.nameDe.localeCompare(b.entry.result.nameDe, "de");
    });
    return hits.slice(0, Math.max(0, limit)).map((h) => ({ ...h.entry.result }));
  }

  return { search, size: entries.length };
}

// Azimutdifferenz auf [-180, 180) wrappen.
function wrap180(deg) {
  return ((deg + 540) % 360) - 180;
}

// Wahrer Winkelabstand zweier Alt/Az-Richtungen in Grad (sphärischer Kosinussatz).
export function angularDistanceDeg(a, b) {
  const alt1 = a.altDeg * DEG;
  const alt2 = b.altDeg * DEG;
  const dAz = (b.azDeg - a.azDeg) * DEG;
  const c =
    Math.sin(alt1) * Math.sin(alt2) +
    Math.cos(alt1) * Math.cos(alt2) * Math.cos(dAz);
  return Math.acos(Math.min(1, Math.max(-1, c))) / DEG;
}

export function targetDirection(targetAltAz, viewAltAz, fovDeg) {
  const dAz = wrap180(targetAltAz.azDeg - viewAltAz.azDeg);
  const dAlt = targetAltAz.altDeg - viewAltAz.altDeg;
  const dist = angularDistanceDeg(viewAltAz, targetAltAz);
  const belowHorizon = targetAltAz.altDeg < 0;
  const inView = dist < 0.45 * fovDeg;

  // Kleinwinkelprojektion um die Blickrichtung; cos(altZiel) skaliert die
  // Azimutdifferenz und neutralisiert den (bedeutungslosen) Azimut im Zenit.
  let x = dAz * Math.cos(targetAltAz.altDeg * DEG); // + = rechts
  const y = dAlt; // + = oben
  if (x === 0 && y === 0 && dist > 1e-9) {
    // Ziel exakt hinter dem Betrachter (180 Grad): Richtung ambivalent,
    // Konvention: Pfeil nach rechts.
    x = 1;
  }
  let screenAngleDeg = 0;
  if (x !== 0 || y !== 0) {
    screenAngleDeg = (Math.atan2(x, y) / DEG + 360) % 360;
  }
  return { inView, screenAngleDeg, angularDistanceDeg: dist, belowHorizon };
}
