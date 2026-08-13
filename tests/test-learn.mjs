// tests/test-learn.mjs – Tests fuer js/learn.js (Teilbereich E)
// Ausfuehren: node tests/test-learn.mjs   (Exit-Code 0 = alles gruen)

import {
  createLearnState,
  reviewItem,
  dueItems,
  saveToStorage,
  loadFromStorage,
  buildQuizPool,
  nextQuestion,
  STORAGE_KEY,
} from "../js/learn.js";

// ---------- Mini-Fixture im Contract-Format ----------

const fixtureStars = {
  meta: { source: "test-fixture", count: 8, magLimit: 6.0 },
  stars: [
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
  ori: { lat: "Orion", de: "Orion", lines: [[27989, 26311, 24436]], info: "Winter." },
  uma: { lat: "Ursa Maior", de: "Großer Bär", lines: [[54061, 62956]], info: "Zirkumpolar." },
  umi: { lat: "Ursa Minor", de: "Kleiner Bär", lines: [[11767]], info: "Polarstern." },
  cma: { lat: "Canis Maior", de: "Großer Hund", lines: [[32349]], info: "Sirius." },
  lyr: { lat: "Lyra", de: "Leier", lines: [[91262]], info: "Sommer." },
};

const fixtureObjects = {
  sonne: { name: "Sonne", typ: "Stern", info: "Zentralgestirn." },
  mond: { name: "Mond", typ: "Mond", info: "Erdtrabant." },
  mars: { name: "Mars", typ: "Planet", info: "Roter Planet." },
  jupiter: { name: "Jupiter", typ: "Planet", info: "Groesster Planet." },
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

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

// ---------- Spaced Repetition ----------

console.log("Spaced Repetition:");

{
  // Intervall-Progression bei quality 5: 10 min -> 1 Tag -> 3 Tage -> wachsend
  const s = createLearnState();
  let t = 1_000_000;
  reviewItem(s, "sb:ori", 5, t);
  const i1 = s.items["sb:ori"].intervalMs;
  check("1. Review (q5) -> 10 min", i1 === 10 * MIN, 10 * MIN, i1);
  check("dueMs = now + Intervall", s.items["sb:ori"].dueMs === t + 10 * MIN, t + 10 * MIN, s.items["sb:ori"].dueMs);

  t += i1;
  reviewItem(s, "sb:ori", 5, t);
  const i2 = s.items["sb:ori"].intervalMs;
  check("2. Review (q5) -> 1 Tag", i2 === DAY, DAY, i2);

  t += i2;
  reviewItem(s, "sb:ori", 5, t);
  const i3 = s.items["sb:ori"].intervalMs;
  check("3. Review (q5) -> 3 Tage", i3 === 3 * DAY, 3 * DAY, i3);

  t += i3;
  reviewItem(s, "sb:ori", 5, t);
  const i4 = s.items["sb:ori"].intervalMs;
  check("4. Review (q5) -> waechst mit Faktor (> 3 Tage)", i4 > 3 * DAY, "> " + 3 * DAY, i4);
  check("4. Intervall ~ 3 Tage * ease (>= 1.3x, <= 2.8x + Rundung)",
    i4 >= 1.3 * 3 * DAY && i4 <= 2.8 * 3 * DAY + 1, "[1.3x, 2.8x]", i4 / (3 * DAY));

  t += i4;
  reviewItem(s, "sb:ori", 5, t);
  const i5 = s.items["sb:ori"].intervalMs;
  check("5. Review (q5) -> weiter wachsend", i5 > i4, "> " + i4, i5);
}

{
  // Reset bei quality < 3
  const s = createLearnState();
  let t = 0;
  reviewItem(s, "x", 5, t); t += 10 * MIN;
  reviewItem(s, "x", 5, t); t += DAY;
  reviewItem(s, "x", 5, t); t += 3 * DAY;
  check("Vor Fehler: reps == 3", s.items["x"].reps === 3, 3, s.items["x"].reps);
  reviewItem(s, "x", 1, t);
  check("Fehler (q1) -> reps == 0", s.items["x"].reps === 0, 0, s.items["x"].reps);
  check("Fehler -> kurzes Intervall (1 min)", s.items["x"].intervalMs === 1 * MIN, MIN, s.items["x"].intervalMs);
  t += MIN;
  reviewItem(s, "x", 5, t);
  check("Nach Fehler beginnt Progression wieder bei 10 min",
    s.items["x"].intervalMs === 10 * MIN, 10 * MIN, s.items["x"].intervalMs);
}

{
  // quality wird geklemmt, ease bleibt in [1.3, 2.8]
  const s = createLearnState();
  let t = 0;
  for (let k = 0; k < 15; k++) { reviewItem(s, "e", 3, t); t = s.items["e"].dueMs; }
  check("ease sinkt bei q3, aber nie unter 1.3", s.items["e"].ease >= 1.3, ">= 1.3", s.items["e"].ease);
  const s2 = createLearnState();
  reviewItem(s2, "y", 99, 0);
  check("quality > 5 wird geklemmt", s2.items["y"].lastQuality === 5, 5, s2.items["y"].lastQuality);
}

{
  // dueItems: Sortierung nach Ueberfaelligkeit, limit
  const s = createLearnState();
  reviewItem(s, "a", 5, 0);        // due 600000
  reviewItem(s, "b", 5, 100_000);  // due 700000
  reviewItem(s, "c", 5, 50_000);   // due 650000
  const due = dueItems(s, 10_000_000);
  check("dueItems: alle faellig", due.length === 3, 3, due.length);
  check("dueItems: am laengsten ueberfaellig zuerst",
    JSON.stringify(due) === JSON.stringify(["a", "c", "b"]), ["a", "c", "b"], due);
  const due2 = dueItems(s, 10_000_000, 2);
  check("dueItems: limit", JSON.stringify(due2) === JSON.stringify(["a", "c"]), ["a", "c"], due2);
  const due3 = dueItems(s, 620_000);
  check("dueItems: nur wirklich faellige", JSON.stringify(due3) === JSON.stringify(["a"]), ["a"], due3);
}

// ---------- Persistenz ----------

console.log("Persistenz:");

function makeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _map: m,
  };
}

{
  // Roundtrip
  const s = createLearnState();
  reviewItem(s, "sb:ori", 5, 1000);
  reviewItem(s, "hs:uma", 2, 2000);
  const storage = makeStorage();
  check("saveToStorage liefert true", saveToStorage(s, storage) === true, true, false);
  const loaded = loadFromStorage(storage);
  check("Roundtrip: Zustand identisch",
    JSON.stringify(loaded) === JSON.stringify(s), s, loaded);
}

{
  // Defensives Parsen
  const empty = loadFromStorage(makeStorage());
  check("Leerer Storage -> frischer Zustand",
    empty.version === 1 && Object.keys(empty.items).length === 0, { version: 1, items: {} }, empty);

  const broken = makeStorage();
  broken.setItem(STORAGE_KEY, "{kaputt::json");
  const b = loadFromStorage(broken);
  check("Kaputtes JSON -> frischer Zustand", Object.keys(b.items).length === 0, {}, b.items);

  const wrongShape = makeStorage();
  wrongShape.setItem(STORAGE_KEY, JSON.stringify({ items: "nope" }));
  const w = loadFromStorage(wrongShape);
  check("Falsche Shape -> frischer Zustand", Object.keys(w.items).length === 0, {}, w.items);

  const partial = makeStorage();
  partial.setItem(STORAGE_KEY, JSON.stringify({
    version: 1,
    items: {
      gut: { reps: 2, ease: 2.5, intervalMs: 1000, dueMs: 5000, lastQuality: 4, lastReviewMs: 4000 },
      schlecht: { reps: "zwei", ease: null, intervalMs: NaN, dueMs: 5000 },
    },
  }));
  const p = loadFromStorage(partial);
  check("Kaputte Items werden verworfen, gute behalten",
    !!p.items["gut"] && !p.items["schlecht"], ["gut"], Object.keys(p.items));

  const throwing = {
    getItem() { throw new Error("SecurityError"); },
    setItem() { throw new Error("QuotaExceeded"); },
  };
  check("Werfender Storage: load -> frischer Zustand",
    Object.keys(loadFromStorage(throwing).items).length === 0, {}, "ok");
  check("Werfender Storage: save -> false",
    saveToStorage(createLearnState(), throwing) === false, false, true);
}

// ---------- Quiz-Generator ----------

console.log("Quiz:");

const pool = buildQuizPool({
  constellations: fixtureConstellations,
  stars: fixtureStars,
  objects: fixtureObjects,
});

{
  check("Pool nicht leer", pool.length > 0, "> 0", pool.length);
  const typen = new Set(pool.map((p) => p.typ));
  check("Alle drei Fragetypen vorhanden",
    typen.has("sternbild-erkennen") && typen.has("hellster-stern") && typen.has("finden"),
    ["sternbild-erkennen", "hellster-stern", "finden"], [...typen]);
  const ids = pool.map((p) => p.id);
  check("Pool-IDs eindeutig", new Set(ids).size === ids.length, ids.length, new Set(ids).size);

  // Keine Frage zu nicht vorhandenen Daten
  const conCodes = new Set(Object.keys(fixtureConstellations));
  const objKeys = new Set(Object.keys(fixtureObjects));
  const hipIds = new Set(fixtureStars.stars.map((r) => "hip:" + r[4]));
  const valid = pool.every((p) => {
    if (p.ziel.art === "sternbild") return conCodes.has(p.ziel.id);
    if (p.ziel.art === "stern") return hipIds.has(p.ziel.id);
    return objKeys.has(p.ziel.id);
  });
  check("Alle Ziel-Referenzen existieren in den Daten", valid, true, valid);

  // hellster-stern: Antwort ist wirklich der hellste benannte Stern
  const hsOri = pool.find((p) => p.id === "hs:ori");
  check('"hellster Stern in Orion" -> Rigel (0.13 < 0.42)',
    hsOri && hsOri.antwort === "Rigel", "Rigel", hsOri && hsOri.antwort);
  const hsCma = pool.find((p) => p.id === "hs:cma");
  check('"hellster Stern im Großen Hund" -> Sirius',
    hsCma && hsCma.antwort === "Sirius", "Sirius", hsCma && hsCma.antwort);

  // finden: Sonne/Mond/Planeten und helle Sterne enthalten
  check('"finden" enthaelt Mars', pool.some((p) => p.id === "find:mars"), true, false);
  check('"finden" enthaelt Sirius (mag <= 1.6)',
    pool.some((p) => p.id === "find:hip:32349"), true, false);
  check('"finden" enthaelt Polarstern NICHT (mag 1.98 > 1.6)',
    !pool.some((p) => p.id === "find:hip:11767"), true, false);

  // sternbild-erkennen: Distraktoren bevorzugt am gleichen Himmel (aehnliche Deklination)
  const sbUma = pool.find((p) => p.id === "sb:uma");
  check("Distraktoren fuer Großer Bär: Kleiner Bär (zirkumpolar) vor Großer Hund (Suedhimmel)",
    sbUma && sbUma.distraktoren.indexOf("Kleiner Bär") < sbUma.distraktoren.indexOf("Großer Hund"),
    "Kleiner Bär vor Großer Hund", sbUma && sbUma.distraktoren);
}

{
  // nextQuestion: 4 Optionen ohne Duplikate, Zielantwort enthalten
  const s = createLearnState();
  const q = nextQuestion(pool, s, 0, 42);
  check("nextQuestion liefert Frage", q !== null, "Frage", q);
  if (q && q.typ !== "finden") {
    check("4 Antwortoptionen", q.optionen.length === 4, 4, q.optionen && q.optionen.length);
    check("Optionen ohne Duplikate", new Set(q.optionen).size === 4, 4, q.optionen);
    check("Zielantwort enthalten", q.optionen.includes(q.antwort), q.antwort, q.optionen);
    check("antwortIndex korrekt", q.optionen[q.antwortIndex] === q.antwort, q.antwort,
      q.optionen && q.optionen[q.antwortIndex]);
  }

  // Multiple-Choice fuer viele Seeds pruefen (immer 4 Optionen, ohne Duplikate, Antwort dabei)
  let allOk = true;
  for (let seed = 0; seed < 50; seed++) {
    const qq = nextQuestion(pool, createLearnState(), 0, seed);
    if (!qq) { allOk = false; break; }
    if (qq.typ === "finden") {
      if (qq.optionen !== null || qq.antwortIndex !== -1) { allOk = false; break; }
      continue;
    }
    if (qq.optionen.length !== 4 || new Set(qq.optionen).size !== 4 ||
        !qq.optionen.includes(qq.antwort) || qq.optionen[qq.antwortIndex] !== qq.antwort) {
      allOk = false;
      break;
    }
  }
  check("50 Seeds: Optionen immer gueltig", allOk, true, allOk);
}

{
  // Determinismus: gleicher Seed -> identische Frage inkl. Optionen-Reihenfolge
  const q1 = nextQuestion(pool, createLearnState(), 0, 7);
  const q2 = nextQuestion(pool, createLearnState(), 0, 7);
  check("Gleicher Seed -> identische Frage",
    JSON.stringify(q1) === JSON.stringify(q2), q1, q2);

  // Verschiedene Seeds -> mindestens eine Abweichung ueber mehrere Seeds
  const variants = new Set();
  for (let seed = 0; seed < 10; seed++) {
    variants.add(JSON.stringify(nextQuestion(pool, createLearnState(), 0, seed)));
  }
  check("Verschiedene Seeds -> Variation", variants.size > 1, "> 1", variants.size);
}

{
  // Faellige Items werden bevorzugt
  const s = createLearnState();
  reviewItem(s, "sb:uma", 5, 0); // due bei 10 min
  const tLater = 20 * MIN;
  const q = nextQuestion(pool, s, tLater, 3);
  check("Faelliges Item wird bevorzugt", q && q.id === "sb:uma", "sb:uma", q && q.id);

  // Nichts faellig, keine neuen -> am fruehesten faelliges
  const s2 = createLearnState();
  let t = 0;
  for (const p of pool) reviewItem(s2, p.id, 5, t++);
  const qq = nextQuestion(pool, s2, 100, 3); // nichts faellig (due erst bei ~10 min)
  check("Nichts faellig -> am fruehesten faelliges Item",
    qq !== null && qq.id === dueSoonest(s2, pool),
    dueSoonest(s2, pool), qq && qq.id);
}

function dueSoonest(state, poolArr) {
  let best = null;
  let bestDue = Infinity;
  for (const p of poolArr) {
    const it = state.items[p.id];
    if (it && it.dueMs < bestDue) { bestDue = it.dueMs; best = p.id; }
  }
  return best;
}

{
  // Leerer Pool
  check("Leerer Pool -> null", nextQuestion([], createLearnState(), 0, 1) === null, null, "?");
  // Pool ohne Daten: buildQuizPool mit leeren Daten erzeugt keine Fragen
  const emptyPool = buildQuizPool({ constellations: {}, stars: [], objects: {} });
  check("Leere Daten -> leerer Pool", emptyPool.length === 0, 0, emptyPool.length);
}

// ---------- Ergebnis ----------

console.log(`\ntest-learn: ${pass} ok, ${fail} fehlgeschlagen`);
process.exit(fail === 0 ? 0 : 1);
