// js/learn.js – Teilbereich E: Spaced-Repetition-Lernkern + Quiz-Generator (Sternenkompass)
//
// Öffentliche API:
//
//   createLearnState() -> { version: 1, items: {} }
//     Plain-JSON-Zustand (serialisierbar). items[itemId] =
//     { reps, ease, intervalMs, dueMs, lastQuality, lastReviewMs }
//
//   reviewItem(state, itemId, quality, nowMs) -> state (mutiert state in-place)
//     quality 0..5 (SM-2-Skala). quality >= 3: Progression
//     10 min -> 1 Tag -> 3 Tage -> Intervall * ease (ease startet 2.5, SM-2-Anpassung,
//     Klemme [1.3, 2.8]). quality < 3: Reset (reps = 0, Wiedervorlage in 1 min,
//     Progression beginnt danach wieder bei 10 min). ease bleibt bei Fehlern erhalten,
//     wird aber nicht erhoeht.
//
//   dueItems(state, nowMs, limit=Infinity) -> [itemId, ...]
//     Faellige Items (dueMs <= nowMs), am laengsten ueberfaellige zuerst,
//     bei Gleichstand alphabetisch (deterministisch).
//
//   saveToStorage(state, storage) -> boolean
//   loadFromStorage(storage) -> state
//     storage ist injiziert (Browser: localStorage; Tests: beliebiges Objekt mit
//     getItem/setItem). loadFromStorage parst defensiv: kaputtes JSON, falsche
//     Shapes oder nicht-finite Zahlen ergeben einen frischen bzw. bereinigten Zustand.
//
//   buildQuizPool({ constellations, stars, objects }) -> [poolItem, ...]
//     Datenformate wie im Contract (stars.json { meta, stars } oder Array,
//     constellations.json, objects.json). Fragetypen:
//       "sternbild-erkennen": "Welches Sternbild ist das?" – Ziel-Sternbild plus
//         Distraktor-Kandidaten, bevorzugt Sternbilder mit aehnlicher Deklination
//         (am gleichen Himmel sichtbar), nur fuer Sternbilder mit Linien.
//       "hellster-stern": "Wie heißt der hellste Stern im Sternbild X?" – nur fuer
//         Sternbilder mit mindestens einem Stern mit Eigennamen.
//       "finden": "Finde X am Himmel." – fuer Sonne/Mond/Planeten und helle benannte
//         Sterne (mag <= 1.6); liefert Ziel-Referenz fuer die Live-Integration.
//     poolItem: { id, typ, frage, antwort, distraktoren: [..], ziel: { art, id, nameDe }, ref }
//
//   nextQuestion(pool, learnState, nowMs, seed=0) -> frage | null
//     Bevorzugt faellige Items (am laengsten ueberfaellig zuerst), sonst neue
//     (deterministisch per Seed gewaehlt), sonst das am fruehesten wieder faellige.
//     Distraktoren: aus den bevorzugten Kandidaten deterministisch gemischt
//     (seeded PRNG, kein Math.random). Rueckgabe:
//     { id, typ, frage, optionen: [4 Strings] | null, antwort, antwortIndex, ziel }
//     ("finden" hat optionen = null und antwortIndex = -1).
//
// Keine Dependencies, kein fetch, kein DOM: lauffähig unter Node 22 und im Browser.

const MIN_MS = 60 * 1000;
const FIRST_INTERVAL_MS = 10 * MIN_MS; // 10 Minuten
const SECOND_INTERVAL_MS = 24 * 60 * MIN_MS; // 1 Tag
const THIRD_INTERVAL_MS = 3 * 24 * 60 * MIN_MS; // 3 Tage
const RELEARN_MS = 1 * MIN_MS; // nach Fehler: in 1 Minute wieder dran
const EASE_START = 2.5;
const EASE_MIN = 1.3;
const EASE_MAX = 2.8;

export const STORAGE_KEY = "sternenkompass.learn.v1";

export function createLearnState() {
  return { version: 1, items: {} };
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

export function reviewItem(state, itemId, quality, nowMs) {
  if (!state || typeof state !== "object" || !state.items) {
    throw new TypeError("reviewItem: state fehlt oder ist kein Lernzustand");
  }
  const q = clamp(Math.round(Number(quality) || 0), 0, 5);
  const now = Number(nowMs);
  if (!Number.isFinite(now)) throw new TypeError("reviewItem: nowMs muss eine Zahl sein");

  const it = state.items[itemId] || {
    reps: 0,
    ease: EASE_START,
    intervalMs: 0,
    dueMs: now,
    lastQuality: null,
    lastReviewMs: null,
  };

  if (q < 3) {
    // Fehler: Progression zuruecksetzen, Item kommt sofort wieder.
    it.reps = 0;
    it.intervalMs = RELEARN_MS;
  } else {
    it.reps += 1;
    if (it.reps === 1) it.intervalMs = FIRST_INTERVAL_MS;
    else if (it.reps === 2) it.intervalMs = SECOND_INTERVAL_MS;
    else if (it.reps === 3) it.intervalMs = THIRD_INTERVAL_MS;
    else it.intervalMs = Math.round(it.intervalMs * it.ease);
    // SM-2-Ease-Anpassung nur bei erfolgreichen Reviews.
    it.ease = clamp(
      it.ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)),
      EASE_MIN,
      EASE_MAX
    );
  }

  it.lastQuality = q;
  it.lastReviewMs = now;
  it.dueMs = now + it.intervalMs;
  state.items[itemId] = it;
  return state;
}

export function dueItems(state, nowMs, limit = Infinity) {
  if (!state || typeof state !== "object" || !state.items) return [];
  const now = Number(nowMs);
  return Object.keys(state.items)
    .filter((id) => state.items[id].dueMs <= now)
    .sort((a, b) => {
      const d = state.items[a].dueMs - state.items[b].dueMs;
      return d !== 0 ? d : a < b ? -1 : a > b ? 1 : 0;
    })
    .slice(0, limit === Infinity ? undefined : Math.max(0, limit));
}

// ---------- Persistenz (storage injiziert; im Browser: localStorage) ----------

export function saveToStorage(state, storage) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    return false; // z. B. Quota, Private Mode
  }
}

function sanitizeItem(raw) {
  if (!raw || typeof raw !== "object") return null;
  const nums = ["reps", "ease", "intervalMs", "dueMs"];
  for (const k of nums) if (!Number.isFinite(raw[k])) return null;
  return {
    reps: Math.max(0, Math.round(raw.reps)),
    ease: clamp(raw.ease, EASE_MIN, EASE_MAX),
    intervalMs: Math.max(0, raw.intervalMs),
    dueMs: raw.dueMs,
    lastQuality: Number.isFinite(raw.lastQuality) ? clamp(Math.round(raw.lastQuality), 0, 5) : null,
    lastReviewMs: Number.isFinite(raw.lastReviewMs) ? raw.lastReviewMs : null,
  };
}

export function loadFromStorage(storage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return createLearnState();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.items || typeof parsed.items !== "object") {
      return createLearnState();
    }
    const state = createLearnState();
    for (const [id, item] of Object.entries(parsed.items)) {
      const clean = sanitizeItem(item);
      if (clean) state.items[id] = clean;
    }
    return state;
  } catch (e) {
    return createLearnState();
  }
}

// ---------- Deterministischer PRNG (mulberry32) ----------

function hashSeed(seed, str) {
  let h = (seed | 0) ^ 2166136261;
  const s = String(str || "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a) {
  let t = a >>> 0;
  return function () {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- Quiz-Generator ----------

function starsArray(stars) {
  if (Array.isArray(stars)) return stars;
  if (stars && Array.isArray(stars.stars)) return stars.stars;
  return [];
}

const FIND_STAR_MAG_LIMIT = 1.6;

export function buildQuizPool({ constellations = {}, stars = [], objects = {} } = {}) {
  const pool = [];
  const rows = starsArray(stars);

  // Sterne nach Sternbild-Kuerzel gruppieren; Mittel-Deklination je Sternbild.
  const byCon = new Map();
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const con = row[7];
    if (!con) continue;
    if (!byCon.has(con)) byCon.set(con, []);
    byCon.get(con).push(row);
  }
  const meanDec = new Map();
  for (const [con, list] of byCon) {
    meanDec.set(con, list.reduce((s, r) => s + (r[1] || 0), 0) / list.length);
  }

  const conEntries = Object.entries(constellations).filter(
    ([, c]) => c && typeof c === "object"
  );
  const conNamesDe = conEntries.map(([code, c]) => c.de || c.lat || code);

  // (1) "Welches Sternbild ist das?" – nur Sternbilder mit Linien (erkennbar).
  for (const [code, con] of conEntries) {
    if (!Array.isArray(con.lines) || con.lines.length === 0) continue;
    const nameDe = con.de || con.lat || code;
    const myDec = meanDec.has(code) ? meanDec.get(code) : 0;
    // Distraktor-Kandidaten: andere Sternbilder, bevorzugt aehnliche Deklination
    // (grob "am gleichen Himmel sichtbar" von Deutschland aus).
    const candidates = conEntries
      .filter(([c2]) => c2 !== code)
      .map(([c2, con2]) => ({
        name: con2.de || con2.lat || c2,
        decDiff: Math.abs((meanDec.has(c2) ? meanDec.get(c2) : 0) - myDec),
      }))
      .sort((a, b) => a.decDiff - b.decDiff || (a.name < b.name ? -1 : 1))
      .map((c) => c.name)
      .filter((n) => n !== nameDe);
    pool.push({
      id: "sb:" + code,
      typ: "sternbild-erkennen",
      frage: "Welches Sternbild ist das?",
      antwort: nameDe,
      distraktoren: candidates,
      ziel: { art: "sternbild", id: code, nameDe },
      ref: con,
    });
  }

  // (2) "Wie heißt der hellste Stern im Sternbild X?" – nur wenn es dort einen
  // Stern mit Eigennamen gibt. Distraktoren: hellste benannte Sterne anderer Sternbilder.
  const brightestNamed = new Map(); // con -> Sternzeile
  for (const [con, list] of byCon) {
    const named = list.filter((r) => typeof r[5] === "string" && r[5].trim() !== "");
    if (named.length === 0) continue;
    named.sort((a, b) => a[2] - b[2]);
    brightestNamed.set(con, named[0]);
  }
  for (const [code, con] of conEntries) {
    const star = brightestNamed.get(code);
    if (!star) continue;
    const nameDe = con.de || con.lat || code;
    const antwort = star[5].trim();
    const candidates = [...brightestNamed.entries()]
      .filter(([c2]) => c2 !== code)
      .map(([, r]) => r)
      .sort((a, b) => a[2] - b[2])
      .map((r) => r[5].trim())
      .filter((n, i, arr) => n !== antwort && arr.indexOf(n) === i);
    pool.push({
      id: "hs:" + code,
      typ: "hellster-stern",
      frage: `Wie heißt der hellste Stern im Sternbild ${nameDe}?`,
      antwort,
      distraktoren: candidates,
      ziel: { art: "stern", id: star[4] ? "hip:" + star[4] : "star:" + antwort, nameDe: antwort },
      ref: star,
    });
  }

  // (3) "Finde X am Himmel." – Sonne/Mond/Planeten plus helle benannte Sterne.
  for (const [key, obj] of Object.entries(objects)) {
    if (!obj || typeof obj !== "object") continue;
    let art;
    if (key === "sonne") art = "sonne";
    else if (key === "mond") art = "mond";
    else if (obj.typ === "Planet") art = "planet";
    else continue;
    const nameDe = obj.name || key;
    pool.push({
      id: "find:" + key,
      typ: "finden",
      frage: `Finde ${nameDe} am Himmel.`,
      antwort: nameDe,
      distraktoren: [],
      ziel: { art, id: key, nameDe },
      ref: obj,
    });
  }
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const name = typeof row[5] === "string" ? row[5].trim() : "";
    if (!name || !(typeof row[2] === "number") || row[2] > FIND_STAR_MAG_LIMIT) continue;
    const id = row[4] ? "hip:" + row[4] : "star:" + name;
    pool.push({
      id: "find:" + id,
      typ: "finden",
      frage: `Finde ${name} am Himmel.`,
      antwort: name,
      distraktoren: [],
      ziel: { art: "stern", id, nameDe: name },
      ref: row,
    });
  }

  // Fallback-Distraktoren, falls einzelne Fragen zu wenige Kandidaten haben.
  for (const item of pool) {
    if (item.typ === "sternbild-erkennen" && item.distraktoren.length < 3) {
      for (const n of conNamesDe) {
        if (n !== item.antwort && !item.distraktoren.includes(n)) item.distraktoren.push(n);
      }
    }
  }

  return pool;
}

const PREFERRED_DISTRACTOR_WINDOW = 6; // aus den besten N Kandidaten wird gemischt

export function nextQuestion(pool, learnState, nowMs, seed = 0) {
  if (!Array.isArray(pool) || pool.length === 0) return null;
  const state = learnState && learnState.items ? learnState : createLearnState();
  const now = Number(nowMs);

  const byId = new Map(pool.map((p) => [p.id, p]));

  // 1) Faellige Items zuerst (am laengsten ueberfaellig vorn, deterministisch).
  let chosen = null;
  for (const id of dueItems(state, now)) {
    if (byId.has(id)) {
      chosen = byId.get(id);
      break;
    }
  }

  // 2) Sonst ein neues Item (noch nie gelernt), deterministisch per Seed gewaehlt.
  if (!chosen) {
    const fresh = pool.filter((p) => !state.items[p.id]);
    if (fresh.length > 0) {
      const rng = mulberry32(hashSeed(seed, "pick"));
      chosen = fresh[Math.floor(rng() * fresh.length)];
    }
  }

  // 3) Sonst das Item, das als naechstes faellig wird.
  if (!chosen) {
    let bestDue = Infinity;
    for (const p of pool) {
      const it = state.items[p.id];
      if (it && it.dueMs < bestDue) {
        bestDue = it.dueMs;
        chosen = p;
      }
    }
  }
  if (!chosen) chosen = pool[0];

  // Frage zusammensetzen; Distraktoren deterministisch aus dem bevorzugten Fenster.
  const rng = mulberry32(hashSeed(seed, chosen.id));
  let optionen = null;
  let antwortIndex = -1;
  if (chosen.typ !== "finden") {
    const uniq = chosen.distraktoren.filter(
      (n, i, arr) => n && n !== chosen.antwort && arr.indexOf(n) === i
    );
    const window = uniq.slice(0, PREFERRED_DISTRACTOR_WINDOW);
    const picked = seededShuffle(window, rng).slice(0, 3);
    // Auffuellen, falls das Fenster nicht reicht (kleine Datensaetze).
    for (const n of uniq) {
      if (picked.length >= 3) break;
      if (!picked.includes(n)) picked.push(n);
    }
    optionen = seededShuffle([chosen.antwort, ...picked], rng);
    antwortIndex = optionen.indexOf(chosen.antwort);
  }

  return {
    id: chosen.id,
    typ: chosen.typ,
    frage: chosen.frage,
    optionen,
    antwort: chosen.antwort,
    antwortIndex,
    ziel: chosen.ziel,
  };
}
