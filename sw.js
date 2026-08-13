/*
 * Sternenkompass – Service Worker (Teilbereich D)
 * =================================================================
 *
 * Cache-Strategie (bewusst gewaehlt, gilt fuer App-Shell UND data/*.json):
 *
 *   CACHE-FIRST mit Versionsstring.
 *
 * Begruendung: Die App ist vollstaendig statisch. Sterne, Sternbilder und
 * Infotexte aendern sich nur, wenn ein neues Release ausgeliefert wird –
 * nicht waehrend der Nutzung. Unter freiem Himmel ist Mobilfunk oft
 * schlecht oder ganz aus, deshalb hat garantierte Offline-Faehigkeit und
 * sofortiger Start Vorrang vor Aktualitaet. Ein Netz-Request pro Datei
 * (network-first) wuerde den Start bei schwachem Empfang um Sekunden
 * verzoegern, ohne dass es inhaltlich etwas bringt.
 *
 * Update-Strategie:
 *   1. Bei jedem Release CACHE_VERSION unten hochzaehlen (Pflicht, sonst
 *      sehen bestehende Installationen die neuen Dateien nie).
 *   2. Der Browser laedt sw.js beim naechsten Seitenaufruf neu (SW-Skripte
 *      werden nicht aus dem HTTP-Cache bedient, max. 24 h Lebensdauer),
 *      erkennt die Byte-Aenderung und installiert den neuen Worker.
 *   3. install: alle Dateien frisch vom Netz in den neuen Cache legen
 *      (cache: "reload" umgeht den HTTP-Cache). Fehlt eine einzelne Datei,
 *      wird das protokolliert, die Installation aber NICHT abgebrochen.
 *   4. skipWaiting + clients.claim: der neue Worker uebernimmt sofort.
 *      Der Nutzer sieht die neue Version also beim naechsten Start,
 *      nicht erst nach dem Schliessen aller Tabs.
 *   5. activate: alle Caches mit fremdem Namen werden geloescht.
 *
 * Laufzeit-Nachcachen: GET-Antworten von gleicher Herkunft, die nicht in
 * der Precache-Liste stehen (z. B. spaeter ergaenzte Dateien), landen nach
 * dem ersten erfolgreichen Abruf ebenfalls im aktuellen Cache.
 *
 * Alles ausserhalb der eigenen Herkunft, alle Nicht-GET-Requests und
 * Range-Requests werden unveraendert durchgereicht.
 */

"use strict";

/* Bei jedem Release hochzaehlen. */
const CACHE_VERSION = "v1.0.3";
const CACHE_NAME = `sternenkompass-${CACHE_VERSION}`;

/* App-Shell: alles, was die App zum Starten braucht. */
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/style.css",
  "./js/app.js",
  "./js/astro.js",
  "./js/render.js",
  "./js/sensors.js",
  "./js/search.js",
  "./js/learn.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png"
];

/* Daten: Sternkatalog, Sternbilder, Infotexte. */
const DATA_FILES = [
  "./data/stars.json",
  "./data/constellations.json",
  "./data/objects.json"
];

const PRECACHE_URLS = APP_SHELL.concat(DATA_FILES);

/* Fallback-Dokument fuer Navigationen ohne Netz. */
const OFFLINE_DOC = "./index.html";

/* ----------------------------------------------------------------- install */
/* Jede Datei einzeln absichern: ein fehlender Teilbereich (z. B. noch keine
   data/*.json) darf die Installation des Workers nicht scheitern lassen. */
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const results = await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          try {
            const request = new Request(url, { cache: "reload" });
            const response = await fetch(request);
            if (!response || !response.ok) {
              throw new Error(`HTTP ${response ? response.status : "?"}`);
            }
            await cache.put(url, response.clone());
            return true;
          } catch (err) {
            console.warn(`[sw] nicht vorgecacht: ${url} (${err.message})`);
            return false;
          }
        })
      );
      const ok = results.filter(Boolean).length;
      console.info(`[sw] ${CACHE_NAME}: ${ok}/${PRECACHE_URLS.length} Dateien vorgecacht`);
      await self.skipWaiting();
    })()
  );
});

/* ---------------------------------------------------------------- activate */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("sternenkompass-") && name !== CACHE_NAME)
          .map((name) => {
            console.info(`[sw] alter Cache entfernt: ${name}`);
            return caches.delete(name);
          })
      );
      if (self.registration.navigationPreload) {
        try {
          await self.registration.navigationPreload.disable();
        } catch (err) {
          /* egal, rein optional */
        }
      }
      await self.clients.claim();
    })()
  );
});

/* ------------------------------------------------------------------- fetch */
self.addEventListener("fetch", (event) => {
  const request = event.request;

  /* Nur GET von gleicher Herkunft wird bedient. */
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch (err) {
    return;
  }
  if (url.origin !== self.location.origin) return;

  /* Range-Requests (Media-Seeking) nicht aus dem Cache beantworten. */
  if (request.headers.has("range")) return;

  event.respondWith(handleRequest(request));
});

async function handleRequest(request) {
  const cache = await caches.open(CACHE_NAME);

  /* Cache-first. ignoreSearch, damit ein angehaengtes ?v=... trotzdem trifft. */
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;

  try {
    const response = await fetch(request);
    /* Erfolgreiche eigene Antworten nachtraeglich mitnehmen. */
    if (response && response.ok && response.type === "basic") {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (err) {
    /* Kein Netz: Navigationen bekommen die App-Shell, sonst 503. */
    if (request.mode === "navigate") {
      const shell =
        (await cache.match(OFFLINE_DOC, { ignoreSearch: true })) ||
        (await cache.match("./", { ignoreSearch: true }));
      if (shell) return shell;
    }
    return new Response(
      "Offline: diese Datei ist nicht im Cache.",
      {
        status: 503,
        statusText: "Service Unavailable",
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      }
    );
  }
}

/* ----------------------------------------------------------------- message */
/* Optionale Steuerung aus der Seite heraus, z. B.
   navigator.serviceWorker.controller.postMessage({ type: "GET_VERSION" }).
   Antwort geht an den mitgeschickten MessagePort, sonst an den Client. */
self.addEventListener("message", (event) => {
  const data = event.data || {};
  const reply = (msg) => {
    if (event.ports && event.ports[0]) event.ports[0].postMessage(msg);
    else if (event.source) event.source.postMessage(msg);
  };
  if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
    reply({ type: "SKIP_WAITING_OK" });
  } else if (data.type === "GET_VERSION") {
    reply({ type: "VERSION", version: CACHE_VERSION, cache: CACHE_NAME });
  }
});
