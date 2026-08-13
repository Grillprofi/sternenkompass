// js/astro.js — Sternenkompass, Teilbereich A: Astronomie-Engine
//
// ES-Modul ohne Dependencies. Laeuft im Browser und unter Node 22.
//
// Quellen:
// - Jean Meeus, "Astronomical Algorithms", 2. Auflage (Sonne Kap. 25,
//   Mond Kap. 47, Sternzeit Kap. 12, Koordinaten Kap. 13, Praezession
//   Kap. 21, Nutation Kap. 22, Refraktion Kap. 16, Illumination Kap. 48,
//   Magnituden Kap. 41).
// - E. M. Standish (JPL), "Approximate Positions of the Planets":
//   heliozentrische Keplerelemente mit Saekularraten, Tabelle fuer
//   1800–2050, bezogen auf Ekliptik und mittleres Aequinoktium J2000.
//
// Bezugssystem der Ausgaben (siehe ARCHITECTURE.md, Abschnitt A):
// RA/Dec werden im Aequinoktium DES DATUMS geliefert.
// - Sonne/Mond: scheinbare Koordinaten (inkl. Nutation, Sonne inkl. Aberration).
// - Planeten: Keplerelemente liefern J2000, danach Praezession J2000 -> Datum
//   (mittleres Aequinoktium des Datums). Lichtlaufzeit ist iterativ
//   beruecksichtigt.
// Winkel in Grad. Azimut: 0 = Nord, 90 = Ost. Geografische Laenge Ost positiv.

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const AU_KM = 149597870.7;          // Astronomische Einheit in km
const LICHT_TAGE_PRO_AE = 0.0057755183; // Lichtlaufzeit in Tagen pro AE

function norm360(x) {
  x = x % 360;
  return x < 0 ? x + 360 : x;
}

function clamp1(x) {
  return Math.min(1, Math.max(-1, x));
}

const sind = (x) => Math.sin(x * D2R);
const cosd = (x) => Math.cos(x * D2R);

// ---------------------------------------------------------------------------
// Zeit
// ---------------------------------------------------------------------------

// JavaScript-Date (UTC) -> Julianisches Datum (UT).
// Unix-Epoche 1970-01-01T00:00Z entspricht JD 2440587.5.
export function jdFromDate(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

// Greenwich Mean Sidereal Time in Grad [0, 360). Meeus Formel 12.4.
export function gmstDeg(jd) {
  const d = jd - 2451545.0;
  const T = d / 36525;
  return norm360(
    280.46061837 + 360.98564736629 * d + 0.000387933 * T * T - (T * T * T) / 38710000
  );
}

// Mittlere Schiefe der Ekliptik in Grad (Meeus 22.2), T in julian. Jahrhunderten ab J2000.
function meanObliquityDeg(T) {
  return 23.43929111 - (46.8150 * T + 0.00059 * T * T - 0.001813 * T * T * T) / 3600;
}

// Gekuerzte Nutation (Hauptterme der IAU-1980-Reihe, Meeus Kap. 22).
// Rueckgabe in Grad. Genauigkeit ~0.5 Bogensekunden, hier voellig ausreichend.
function nutation(T) {
  const om = 125.04452 - 1934.136261 * T;        // Knoten der Mondbahn
  const ls2 = 2 * (280.4665 + 36000.7698 * T);   // 2 * mittlere Laenge Sonne
  const lm2 = 2 * (218.3165 + 481267.8813 * T);  // 2 * mittlere Laenge Mond
  const dPsi =
    (-17.2 * sind(om) - 1.32 * sind(ls2) - 0.23 * sind(lm2) + 0.21 * sind(2 * om)) / 3600;
  const dEps =
    (9.2 * cosd(om) + 0.57 * cosd(ls2) + 0.1 * cosd(lm2) - 0.09 * cosd(2 * om)) / 3600;
  return { dPsi, dEps };
}

// Ekliptikal (lambda, beta) -> aequatorial (RA, Dec), gleiche Epoche. Meeus 13.3/13.4.
function eclToEq(lamDeg, betaDeg, epsDeg) {
  const sl = sind(lamDeg), cl = cosd(lamDeg);
  const sb = sind(betaDeg), cb = cosd(betaDeg);
  const se = sind(epsDeg), ce = cosd(epsDeg);
  const raDeg = norm360(Math.atan2(sl * ce - (sb / cb) * se, cl) * R2D);
  const decDeg = Math.asin(clamp1(sb * ce + cb * se * sl)) * R2D;
  return { raDeg, decDeg };
}

// Praezession aequatorialer Koordinaten von J2000.0 zum Datum (Meeus Kap. 21).
// Oeffentliche Variante fuer Sternkataloge (stars.json ist J2000): jd statt T.
export function precessStarJ2000ToDate(raDeg, decDeg, jd) {
  return precessJ2000ToDate(raDeg, decDeg, (jd - 2451545.0) / 36525.0);
}

function precessJ2000ToDate(raDeg, decDeg, T) {
  const T2 = T * T, T3 = T2 * T;
  const zeta = (2306.2181 * T + 0.30188 * T2 + 0.017998 * T3) / 3600;
  const z = (2306.2181 * T + 1.09468 * T2 + 0.018203 * T3) / 3600;
  const theta = (2004.3109 * T - 0.42665 * T2 - 0.041833 * T3) / 3600;
  const cd = cosd(decDeg), sd = sind(decDeg);
  const cazeta = cosd(raDeg + zeta), sazeta = sind(raDeg + zeta);
  const ct = cosd(theta), st = sind(theta);
  const A = cd * sazeta;
  const B = ct * cd * cazeta - st * sd;
  const C = st * cd * cazeta + ct * sd;
  return {
    raDeg: norm360(Math.atan2(A, B) * R2D + z),
    decDeg: Math.asin(clamp1(C)) * R2D,
  };
}

// ---------------------------------------------------------------------------
// Koordinaten Himmel <-> Horizont
// ---------------------------------------------------------------------------

// RA/Dec (Aequinoktium des Datums) -> Azimut/Hoehe, geometrisch, ohne Refraktion.
// Azimut 0 = Nord, 90 = Ost. Meeus Kap. 13.
export function raDecToAltAz(raDeg, decDeg, jd, obs) {
  const Hdeg = gmstDeg(jd) + obs.lonDeg - raDeg; // Stundenwinkel, westlich positiv
  const H = Hdeg * D2R;
  const phi = obs.latDeg * D2R;
  const dec = decDeg * D2R;
  const sinAlt = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H);
  const altDeg = Math.asin(clamp1(sinAlt)) * R2D;
  // Meeus 13.5 liefert Azimut ab Sued (westlich positiv); +180 -> ab Nord.
  const azSued = Math.atan2(
    Math.sin(H),
    Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)
  );
  return { azDeg: norm360(azSued * R2D + 180), altDeg };
}

// Umkehrung: Azimut/Hoehe (geometrisch) -> RA/Dec (Aequinoktium des Datums).
export function altAzToRaDec(azDeg, altDeg, jd, obs) {
  const A = (azDeg - 180) * D2R; // Azimut ab Sued, westlich positiv
  const h = altDeg * D2R;
  const phi = obs.latDeg * D2R;
  const H = Math.atan2(
    Math.sin(A),
    Math.cos(A) * Math.sin(phi) + Math.tan(h) * Math.cos(phi)
  );
  const dec = Math.asin(
    clamp1(Math.sin(phi) * Math.sin(h) - Math.cos(phi) * Math.cos(h) * Math.cos(A))
  );
  return {
    raDeg: norm360(gmstDeg(jd) + obs.lonDeg - H * R2D),
    decDeg: dec * R2D,
  };
}

// Saemundsson-Refraktion (Meeus 16.4) fuer die WAHRE Hoehe altDeg.
// Ergebnis in Grad; auf altDeg addieren ergibt die scheinbare Hoehe.
// Standardatmosphaere (1010 hPa, 10 Grad C).
export function refractionDeg(altDeg) {
  const h = Math.max(altDeg, -1.9); // unterhalb sinnfrei, Formel wird singulaer
  const r = 1.02 / Math.tan((h + 10.3 / (h + 5.11)) * D2R) / 60;
  return Math.max(r, 0); // nahe Zenit liefert die Formel minimal negative Werte
}

// ---------------------------------------------------------------------------
// Sonne (Meeus Kap. 25, "geringere Genauigkeit": besser als 0.01 Grad)
// ---------------------------------------------------------------------------

function sunApparent(T) {
  const L0 = norm360(280.46646 + 36000.76983 * T + 0.0003032 * T * T);
  const M = norm360(357.52911 + 35999.05029 * T - 0.0001537 * T * T);
  const e = 0.016708634 - 0.000042037 * T - 0.0000001267 * T * T;
  const C =
    (1.914602 - 0.004817 * T - 0.000014 * T * T) * sind(M) +
    (0.019993 - 0.000101 * T) * sind(2 * M) +
    0.000289 * sind(3 * M);
  const trueLon = L0 + C;   // wahre Laenge
  const nu = M + C;         // wahre Anomalie
  const distAU = (1.000001018 * (1 - e * e)) / (1 + e * cosd(nu));
  const omega = 125.04 - 1934.136 * T;
  // Scheinbare Laenge: Korrektur fuer Nutation und Aberration (Meeus 25.8).
  const lamApp = norm360(trueLon - 0.00569 - 0.00478 * sind(omega));
  const eps = meanObliquityDeg(T) + 0.00256 * cosd(omega);
  const eq = eclToEq(lamApp, 0, eps);
  return { lamAppDeg: lamApp, distAU, raDeg: eq.raDeg, decDeg: eq.decDeg };
}

// Scheinbare geozentrische Sonnenposition, Aequinoktium des Datums.
export function sunEquatorial(jd) {
  const s = sunApparent((jd - 2451545.0) / 36525);
  return { raDeg: s.raDeg, decDeg: s.decDeg, distAU: s.distAU };
}

// ---------------------------------------------------------------------------
// Mond (Meeus Kap. 47: Haupttabellen 47.a und 47.b der gekuerzten ELP-2000/82)
// ---------------------------------------------------------------------------

// Terme fuer Laenge (l, Einheit 1e-6 Grad) und Distanz (r, Einheit 1e-3 km).
// Spalten: [D, M, M', F, l, r]
const MOND_LR = [
  [0, 0, 1, 0, 6288774, -20905355],
  [2, 0, -1, 0, 1274027, -3699111],
  [2, 0, 0, 0, 658314, -2955968],
  [0, 0, 2, 0, 213618, -569925],
  [0, 1, 0, 0, -185116, 48888],
  [0, 0, 0, 2, -114332, -3149],
  [2, 0, -2, 0, 58793, 246158],
  [2, -1, -1, 0, 57066, -152138],
  [2, 0, 1, 0, 53322, -170733],
  [2, -1, 0, 0, 45758, -204586],
  [0, 1, -1, 0, -40923, -129620],
  [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755],
  [2, 0, 0, -2, 15327, 10321],
  [0, 0, 1, 2, -12528, 0],
  [0, 0, 1, -2, 10980, 79661],
  [4, 0, -1, 0, 10675, -34782],
  [0, 0, 3, 0, 10034, -23210],
  [4, 0, -2, 0, 8548, -21636],
  [2, 1, -1, 0, -7888, 24208],
  [2, 1, 0, 0, -6766, 30824],
  [1, 0, -1, 0, -5163, -8379],
  [1, 1, 0, 0, 4987, -16675],
  [2, -1, 1, 0, 4036, -12831],
  [2, 0, 2, 0, 3994, -10445],
  [4, 0, 0, 0, 3861, -11650],
  [2, 0, -3, 0, 3665, 14403],
  [0, 1, -2, 0, -2689, -7003],
  [2, 0, -1, 2, -2602, 0],
  [2, -1, -2, 0, 2390, 10056],
  [1, 0, 1, 0, -2348, 6322],
  [2, -2, 0, 0, 2236, -9884],
  [0, 1, 2, 0, -2120, 5751],
  [0, 2, 0, 0, -2069, 0],
  [2, -2, -1, 0, 2048, -4950],
  [2, 0, 1, -2, -1773, 4130],
  [2, 0, 0, 2, -1595, 0],
  [4, -1, -1, 0, 1215, -3958],
  [0, 0, 2, 2, -1110, 0],
  [3, 0, -1, 0, -892, 3258],
  [2, 1, 1, 0, -810, 2616],
  [4, -1, -2, 0, 759, -1897],
  [0, 2, -1, 0, -713, -2117],
  [2, 2, -1, 0, -700, 2354],
  [2, 1, -2, 0, 691, 0],
  [2, -1, 0, -2, 596, 0],
  [4, 0, 1, 0, 549, -1423],
  [0, 0, 4, 0, 537, -1117],
  [4, -1, 0, 0, 520, -1571],
  [1, 0, -2, 0, -487, -1739],
  [2, 1, 0, -2, -399, 0],
  [0, 0, 2, -2, -381, -4421],
  [1, 1, 1, 0, 351, 0],
  [3, 0, -2, 0, -340, 0],
  [4, 0, -3, 0, 330, 0],
  [2, -1, 2, 0, 327, 0],
  [0, 2, 1, 0, -323, 1165],
  [1, 1, -1, 0, 299, 0],
  [2, 0, 3, 0, 294, 0],
  [2, 0, -1, -2, 0, 8752],
];

// Terme fuer Breite (b, Einheit 1e-6 Grad). Spalten: [D, M, M', F, b]
const MOND_B = [
  [0, 0, 0, 1, 5128122],
  [0, 0, 1, 1, 280602],
  [0, 0, 1, -1, 277693],
  [2, 0, 0, -1, 173237],
  [2, 0, -1, 1, 55413],
  [2, 0, -1, -1, 46271],
  [2, 0, 0, 1, 32573],
  [0, 0, 2, 1, 17198],
  [2, 0, 1, -1, 9266],
  [0, 0, 2, -1, 8822],
  [2, -1, 0, -1, 8216],
  [2, 0, -2, -1, 4324],
  [2, 0, 1, 1, 4200],
  [2, 1, 0, -1, -3359],
  [2, -1, -1, 1, 2463],
  [2, -1, 0, 1, 2211],
  [2, -1, -1, -1, 2065],
  [0, 1, -1, -1, -1870],
  [4, 0, -1, -1, 1828],
  [0, 1, 0, 1, -1794],
  [0, 0, 0, 3, -1749],
  [0, 1, -1, 1, -1565],
  [1, 0, 0, 1, -1491],
  [0, 1, 1, 1, -1475],
  [0, 1, 1, -1, -1410],
  [0, 1, 0, -1, -1344],
  [1, 0, 0, -1, -1335],
  [0, 0, 3, 1, 1107],
  [4, 0, 0, -1, 1021],
  [4, 0, -1, 1, 833],
  [0, 0, 1, -3, 777],
  [4, 0, -2, 1, 671],
  [2, 0, 0, -3, 607],
  [2, 0, 2, -1, 596],
  [2, -1, 1, -1, 491],
  [2, 0, -2, 1, -451],
  [0, 0, 3, -1, 439],
  [2, 0, 2, 1, 422],
  [2, 0, -3, -1, 421],
  [2, 1, -1, 1, -366],
  [2, 1, 0, 1, -351],
  [4, 0, 0, 1, 331],
  [2, -1, 1, 1, 315],
  [2, -2, 0, -1, 302],
  [0, 0, 1, 3, -283],
  [2, 1, 1, -1, -229],
  [1, 1, 0, -1, 223],
  [1, 1, 0, 1, 223],
  [0, 1, -2, -1, -220],
  [2, 1, -1, -1, -220],
  [1, 0, 1, 1, -185],
  [2, -1, -2, -1, 181],
  [0, 1, 2, 1, -177],
  [4, 0, -2, -1, 176],
  [4, -1, -1, -1, 166],
  [1, 0, 1, -1, -164],
  [4, 0, 1, -1, 132],
  [1, 0, -1, -1, -119],
  [4, -1, 0, -1, 115],
  [2, -2, 0, 1, 107],
];

// Scheinbare geozentrische Mondposition (Aequinoktium des Datums) plus
// Beleuchtungsdaten. Ziel < 0.5 Grad, tatsaechlich deutlich besser (~0.01 Grad).
export function moonEquatorial(jd) {
  const T = (jd - 2451545.0) / 36525;
  const T2 = T * T, T3 = T2 * T, T4 = T3 * T;

  // Fundamentalargumente (Meeus 47.1 bis 47.5), Grad
  const Lp = norm360(218.3164477 + 481267.88123421 * T - 0.0015786 * T2 + T3 / 538841 - T4 / 65194000);
  const D = norm360(297.8501921 + 445267.1114034 * T - 0.0018819 * T2 + T3 / 545868 - T4 / 113065000);
  const M = norm360(357.5291092 + 35999.0502909 * T - 0.0001536 * T2 + T3 / 24490000);
  const Mp = norm360(134.9633964 + 477198.8675055 * T + 0.0087414 * T2 + T3 / 69699 - T4 / 14712000);
  const F = norm360(93.272095 + 483202.0175233 * T - 0.0036539 * T2 - T3 / 3526000 + T4 / 863310000);
  const A1 = norm360(119.75 + 131.849 * T);       // Venus-Stoerung
  const A2 = norm360(53.09 + 479264.29 * T);      // Jupiter-Stoerung
  const A3 = norm360(313.45 + 481266.484 * T);
  const E = 1 - 0.002516 * T - 0.0000074 * T2;    // Exzentrizitaetsfaktor der Erdbahn

  let sumL = 0, sumR = 0, sumB = 0;
  for (const [d, m, mp, f, l, r] of MOND_LR) {
    const arg = d * D + m * M + mp * Mp + f * F;
    const eFak = m === 0 ? 1 : Math.pow(E, Math.abs(m));
    sumL += l * eFak * sind(arg);
    sumR += r * eFak * cosd(arg);
  }
  for (const [d, m, mp, f, b] of MOND_B) {
    const arg = d * D + m * M + mp * Mp + f * F;
    const eFak = m === 0 ? 1 : Math.pow(E, Math.abs(m));
    sumB += b * eFak * sind(arg);
  }
  // Additive Terme (Venus, Jupiter, Abplattung; Meeus S. 342)
  sumL += 3958 * sind(A1) + 1962 * sind(Lp - F) + 318 * sind(A2);
  sumB += -2235 * sind(Lp) + 382 * sind(A3) + 175 * sind(A1 - F) + 175 * sind(A1 + F)
        + 127 * sind(Lp - Mp) - 115 * sind(Lp + Mp);

  const lam = norm360(Lp + sumL / 1e6); // geozentrische Laenge, mittleres Aequinoktium
  const beta = sumB / 1e6;              // geozentrische Breite
  const distKm = 385000.56 + sumR / 1000;

  // Scheinbare Koordinaten: Nutation in Laenge addieren, wahre Schiefe verwenden.
  const nut = nutation(T);
  const lamApp = norm360(lam + nut.dPsi);
  const epsTrue = meanObliquityDeg(T) + nut.dEps;
  const eq = eclToEq(lamApp, beta, epsTrue);

  // Beleuchtung (Meeus Kap. 48): Phasenwinkel ueber Elongation psi.
  const s = sunApparent(T);
  const sunKm = s.distAU * AU_KM;
  const cosPsi = clamp1(cosd(lamApp - s.lamAppDeg) * cosd(beta));
  const psi = Math.acos(cosPsi); // 0..pi
  const i = Math.atan2(sunKm * Math.sin(psi), distKm - sunKm * cosPsi); // Phasenwinkel
  const illumFraction = (1 + Math.cos(i)) / 2;
  // Zunehmend, solange der Mond der Sonne in Laenge 0..180 Grad voraus ist.
  const isWaxing = norm360(lamApp - s.lamAppDeg) < 180;

  return {
    raDeg: eq.raDeg,
    decDeg: eq.decDeg,
    distKm,
    illumFraction,
    phaseAngleDeg: i * R2D,
    isWaxing,
  };
}

// ---------------------------------------------------------------------------
// Planeten (Standish/JPL: Keplerelemente mit Saekularraten, 1800–2050)
// ---------------------------------------------------------------------------

export const PLANET_NAMES = ["merkur", "venus", "mars", "jupiter", "saturn", "uranus", "neptun"];

// [a AE, da/cy, e, de/cy, I Grad, dI/cy, L Grad, dL/cy, peri(ϖ) Grad, dperi/cy, node(Ω) Grad, dnode/cy]
// "erde" = Erde-Mond-Baryzentrum (fuer die geozentrische Differenzbildung).
const KEPLER_ELEMENTE = {
  merkur: [0.38709927, 0.00000037, 0.20563593, 0.00001906, 7.00497902, -0.00594749,
    252.2503235, 149472.67411175, 77.45779628, 0.16047689, 48.33076593, -0.12534081],
  venus: [0.72333566, 0.0000039, 0.00677672, -0.00004107, 3.39467605, -0.0007889,
    181.9790995, 58517.81538729, 131.60246718, 0.00268329, 76.67984255, -0.27769418],
  erde: [1.00000261, 0.00000562, 0.01671123, -0.00004392, -0.00001531, -0.01294668,
    100.46457166, 35999.37244981, 102.93768193, 0.32327364, 0.0, 0.0],
  mars: [1.52371034, 0.00001847, 0.0933941, 0.00007882, 1.84969142, -0.00813131,
    -4.55343205, 19140.30268499, -23.94362959, 0.44441088, 49.55953891, -0.29257343],
  jupiter: [5.202887, -0.00011607, 0.04838624, -0.00013253, 1.30439695, -0.00183714,
    34.39644051, 3034.74612775, 14.72847983, 0.21252668, 100.47390909, 0.20469106],
  saturn: [9.53667594, -0.0012506, 0.05386179, -0.00050991, 2.48599187, 0.00193609,
    49.95424423, 1222.49362201, 92.59887831, -0.41897216, 113.66242448, -0.28867794],
  uranus: [19.18916464, -0.00196176, 0.04725744, -0.00004397, 0.77263783, -0.00242939,
    313.23810451, 428.48202785, 170.9542763, 0.40805281, 74.01692503, 0.04240589],
  neptun: [30.06992276, 0.00026291, 0.00859048, 0.00005105, 1.77004347, 0.00035372,
    -55.12002969, 218.45945325, 44.96476227, -0.32241464, 131.78422574, -0.00508664],
};

// Kepler-Gleichung M = E - e*sin(E), Newton-Iteration (Radiant).
function solveKepler(Mrad, e) {
  let Ecc = Mrad + e * Math.sin(Mrad);
  for (let k = 0; k < 30; k++) {
    const dE = (Mrad - (Ecc - e * Math.sin(Ecc))) / (1 - e * Math.cos(Ecc));
    Ecc += dE;
    if (Math.abs(dE) < 1e-12) break;
  }
  return Ecc;
}

// Heliozentrische Position in ekliptikalen J2000-Koordinaten (AE).
function helioEclJ2000(el, T) {
  const a = el[0] + el[1] * T;
  const e = el[2] + el[3] * T;
  const I = el[4] + el[5] * T;
  const L = el[6] + el[7] * T;
  const peri = el[8] + el[9] * T;
  const node = el[10] + el[11] * T;
  const omega = peri - node;              // Argument des Perihels
  let M = norm360(L - peri);              // mittlere Anomalie
  if (M > 180) M -= 360;
  const Ecc = solveKepler(M * D2R, e);
  const xp = a * (Math.cos(Ecc) - e);     // Bahnebene, x Richtung Perihel
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(Ecc);
  const cw = cosd(omega), sw = sind(omega);
  const cO = cosd(node), sO = sind(node);
  const ci = cosd(I), si = sind(I);
  return {
    x: (cw * cO - sw * sO * ci) * xp + (-sw * cO - cw * sO * ci) * yp,
    y: (cw * sO + sw * cO * ci) * xp + (-sw * sO + cw * cO * ci) * yp,
    z: sw * si * xp + cw * si * yp,
  };
}

// Scheinbare Magnitude (Meeus Kap. 41, Astronomical Almanac 1984).
// r = heliozentr. Distanz, delta = geozentr. Distanz (AE), i = Phasenwinkel Grad.
// Fuer Saturn zusaetzlich Ringneigung B aus geozentrischer Ekliptikposition.
function magnitudeFor(name, r, delta, iDeg, geo, T) {
  const g = 5 * Math.log10(r * delta);
  switch (name) {
    case "merkur":
      return -0.42 + g + 0.038 * iDeg - 0.000273 * iDeg * iDeg + 0.000002 * iDeg * iDeg * iDeg;
    case "venus":
      return -4.4 + g + 0.0009 * iDeg + 0.000239 * iDeg * iDeg - 0.00000065 * iDeg * iDeg * iDeg;
    case "mars":
      return -1.52 + g + 0.016 * iDeg;
    case "jupiter":
      return -9.4 + g + 0.005 * iDeg;
    case "saturn": {
      // Ringneigung B (Meeus Kap. 45, vereinfacht; Laenge naeherungsweise auf Datum praezediert)
      const lam = norm360(Math.atan2(geo.y, geo.x) * R2D + 1.396971 * T);
      const beta = Math.asin(clamp1(geo.z / delta)) * R2D;
      const ir = 28.075216 - 0.012998 * T;
      const Or = 169.50847 + 1.394681 * T;
      const sinB = -sind(ir) * cosd(beta) * sind(lam - Or) - cosd(ir) * sind(beta);
      const B = Math.asin(clamp1(sinB));
      return -8.88 + g - 2.6 * Math.abs(Math.sin(B)) + 1.25 * Math.sin(B) * Math.sin(B);
    }
    case "uranus":
      return -7.19 + g;
    case "neptun":
      return -6.87 + g;
    default:
      return NaN;
  }
}

// Geozentrische Planetenposition, Aequinoktium des Datums, mit Lichtlaufzeit.
export function planetEquatorial(name, jd) {
  const key = String(name).toLowerCase();
  const el = KEPLER_ELEMENTE[key];
  if (!el || key === "erde") {
    throw new Error(`Unbekannter Planet: ${name} (erlaubt: ${PLANET_NAMES.join(", ")})`);
  }
  const T = (jd - 2451545.0) / 36525;
  const erde = helioEclJ2000(KEPLER_ELEMENTE.erde, T);

  // Lichtlaufzeit-Iteration: Planet zum Emissionszeitpunkt, Erde zum Empfangszeitpunkt.
  let tau = 0, p = null, gx = 0, gy = 0, gz = 0, dist = 0;
  for (let k = 0; k < 4; k++) {
    p = helioEclJ2000(el, T - tau / 36525);
    gx = p.x - erde.x;
    gy = p.y - erde.y;
    gz = p.z - erde.z;
    dist = Math.sqrt(gx * gx + gy * gy + gz * gz);
    tau = dist * LICHT_TAGE_PRO_AE;
  }

  // Ekliptikal J2000 -> aequatorial J2000 (Schiefe J2000: 23.43928 Grad)
  const eps0 = 23.43928 * D2R;
  const xe = gx;
  const ye = gy * Math.cos(eps0) - gz * Math.sin(eps0);
  const ze = gy * Math.sin(eps0) + gz * Math.cos(eps0);
  const raJ2000 = norm360(Math.atan2(ye, xe) * R2D);
  const decJ2000 = Math.asin(clamp1(ze / dist)) * R2D;

  // Praezession J2000 -> Aequinoktium des Datums
  const eq = precessJ2000ToDate(raJ2000, decJ2000, T);

  // Phasenwinkel: Dreieck Sonne–Planet–Erde
  const r = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
  const R = Math.sqrt(erde.x * erde.x + erde.y * erde.y + erde.z * erde.z);
  const iDeg = Math.acos(clamp1((r * r + dist * dist - R * R) / (2 * r * dist))) * R2D;

  return {
    raDeg: eq.raDeg,
    decDeg: eq.decDeg,
    distAU: dist,
    magnitude: magnitudeFor(key, r, dist, iDeg, { x: gx, y: gy, z: gz }, T),
  };
}
