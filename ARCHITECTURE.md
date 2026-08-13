# Sternenkompass – Architektur-Contract (V1)

Interaktive Sternenhimmel-Lernapp als statische Web-App (PWA). Kein Build-Schritt, kein Framework: reine ES-Module, lauffähig direkt von GitHub Pages. Zielgerät: iPhone (Safari), sekundär Desktop-Browser. Sprache der UI: Deutsch.

Dieser Contract ist bindend für alle Teilbereiche. Wer eine Schnittstelle ändern muss, dokumentiert das hier im Abschnitt "Abweichungen".

## Dateibesitz (parallel bearbeitbar, disjunkt)

| Datei | Teilbereich |
|---|---|
| `js/astro.js`, `tests/test-astro.mjs` | A Astronomie-Engine |
| `data/*.json`, `tools/build-data.mjs`, `tools/DATA_SOURCES.md` | B Datenpipeline |
| `index.html`, `css/style.css`, `js/render.js`, `js/sensors.js`, `js/app.js` | C Renderer/UI |
| `manifest.webmanifest`, `sw.js`, `icons/*`, `DEPLOY.md` | D PWA/Deploy |

## Konventionen

- Winkel in Grad in allen Schnittstellen. Azimut: 0 = Nord, 90 = Ost, 180 = Süd, 270 = West. Geografische Länge: Ost positiv.
- Zeit: JavaScript `Date` (UTC-basiert) bzw. Julianisches Datum `jd` (number).
- Beobachter-Objekt: `{ latDeg, lonDeg }`. Default bis GPS-Freigabe: Essen `{ latDeg: 51.4556, lonDeg: 7.0116 }`.
- ES-Module, `"use strict"` implizit, keine externen Dependencies, keine CDN-Loads (offlinefähig).
- Kommentare und Bezeichner der öffentlichen API wie hier spezifiziert; interne Namen frei.

## A. `js/astro.js` – öffentliche API

```js
export function jdFromDate(date)                    // Date -> Julianisches Datum (UT)
export function gmstDeg(jd)                         // Greenwich Mean Sidereal Time in Grad [0,360)
export function raDecToAltAz(raDeg, decDeg, jd, obs)   // -> { azDeg, altDeg } (geometrisch, ohne Refraktion)
export function altAzToRaDec(azDeg, altDeg, jd, obs)   // -> { raDeg, decDeg }
export function refractionDeg(altDeg)               // Sæmundsson-Refraktion; auf altDeg addieren ergibt scheinbare Höhe
export function sunEquatorial(jd)                   // -> { raDeg, decDeg, distAU }
export function moonEquatorial(jd)                  // -> { raDeg, decDeg, distKm, illumFraction, phaseAngleDeg, isWaxing }
export function planetEquatorial(name, jd)          // -> { raDeg, decDeg, distAU, magnitude }
export const PLANET_NAMES                           // ["merkur","venus","mars","jupiter","saturn","uranus","neptun"]
```

- Planeten: heliozentrische Keplerelemente mit Säkularraten (JPL-Näherung, gültig 1800–2050), Lichtlaufzeit-Iteration, geozentrisch äquatorial (Epoche des Datums genügt; wenn J2000 geliefert wird, hier dokumentieren). Zielgenauigkeit < 0,2 Grad.
- Mond: gekürzte ELP/Meeus-Reihen, Ziel < 0,5 Grad. `illumFraction` 0..1.
- Sonne: Ziel < 0,05 Grad.
- Magnituden: Standardformeln (Meeus/Mallama vereinfacht) reichen.
- `tests/test-astro.mjs`: mit `node tests/test-astro.mjs` lauffähig, Exit-Code ungleich 0 bei Fehlschlag. Pflicht-Referenzfälle (Toleranz ±0,5 Grad, Distanz ±2 %):
  - Mars, 2026-08-12 22:35 UT, Essen (51.4556 N, 7.0116 O): Az ≈ 33,3, Alt ≈ −8,3 (geometrisch), RA ≈ 6,05 h, Dec ≈ +23,7, Distanz ≈ 1,945 AE.
  - Sonne, gleiche Zeit/Ort: Az ≈ 344,2, Alt ≈ −22,4, RA ≈ 142,3 Grad, Dec ≈ +14,85.
  - Mindestens vier weitere unabhängige Referenzfälle (andere Planeten, Mond, andere Daten) mit dokumentierter Quelle im Testkommentar.

## B. `data/*.json` – Formate

`data/stars.json` (Sterne bis mag 6,0 plus alle in Sternbildlinien referenzierten):

```json
{ "meta": { "source": "...", "count": 0, "magLimit": 6.0 },
  "stars": [ [raDeg, decDeg, mag, bv, hip, "Eigenname oder leer", "Bayer oder leer", "con-Kürzel", distLj, "Spektralklasse oder leer"] ] }
```

- `raDeg`/`decDeg` J2000, 4 Dezimalstellen. `mag`, `bv` 2 Dezimalstellen. `hip` 0 wenn unbekannt. `distLj` gerundet ganzzahlig, 0 wenn unbekannt. `con-Kürzel` IAU-3-Buchstaben klein ("ori", "uma", ...).

`data/constellations.json` (alle 88):

```json
{ "ori": { "lat": "Orion", "de": "Orion", "lines": [[hip1, hip2, hip3], [hip4, hip5]],
           "info": "2 bis 4 Sätze Deutsch: Erkennungsmerkmale, hellste Sterne, Mythologie, beste Jahreszeit von Deutschland aus." } }
```

- `lines`: Polylinien aus HIP-Nummern; jede referenzierte HIP muss in `stars.json` vorkommen.

`data/objects.json` (Infotexte Deutsch für Nicht-Sterne):

```json
{ "sonne": { "name": "Sonne", "typ": "Stern", "info": "..." },
  "mond":  { "name": "Mond",  "typ": "Mond",  "info": "..." },
  "merkur": { "name": "Merkur", "typ": "Planet", "info": "..." }, "...": "venus, mars, jupiter, saturn, uranus, neptun" }
```

- Infotexte: 3 bis 5 Sätze, lehrreich, konkret (Größe, Distanz, Besonderheiten, Beobachtungstipp), Deutsch, keine Emojis.
- `tools/DATA_SOURCES.md`: Quellen, Lizenzen, Pipeline-Doku. `tools/build-data.mjs`: reproduzierbare Erzeugung.

## C. Renderer/UI

- `index.html`: App-Shell. Muss enthalten: `<link rel="manifest" href="manifest.webmanifest">`, `<meta name="theme-color" content="#0a0e1a">`, `<meta name="apple-mobile-web-app-capable" content="yes">`, `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`, `<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">`, Viewport mit `viewport-fit=cover`. Service-Worker-Registrierung in `js/app.js`, geschützt mit `if ("serviceWorker" in navigator)`.
- `js/render.js`: Sternkarte auf `<canvas>`; WebGL für Sterne empfohlen, 2D-Overlay für Linien/Labels erlaubt. 30+ fps auf iPhone. Sterngröße nach Magnitude, Sternfarbe nach B-V. Horizontlinie mit Himmelsrichtungen N/O/S/W, dezente Boden-Abdunklung unter dem Horizont, Sternbildlinien und -namen (toggle), Planeten/Mond/Sonne mit Symbol und Label, Mond mit Phasendarstellung. Projektion: perspektivisch, FOV 20 bis 100 Grad, Default 60.
- `js/sensors.js`: iOS-Freigabe (`DeviceOrientationEvent.requestPermission` nur aus User-Geste), `webkitCompassHeading` bevorzugt, Fallback `deviceorientationabsolute`; liefert Blickrichtung `{ azDeg, altDeg, rollDeg }` mit Glättung. Geolocation optional per Button, Default Essen. Modus-Umschaltung Sensor/Manuell; Manuell = Ein-Finger-Schwenken, Pinch-Zoom (FOV).
- `js/app.js`: Verdrahtung, Zustand `{ date, observer, view, settings }`, Tick-Loop (Positionen von Sonne/Mond/Planeten einmal pro Sekunde neu, Sterne pro Frame nur rotiert), Antipp-Picking (nächstes Objekt < 24 px), Info-Panel (Name, Typ, Sternbild, Magnitude, Distanz, live Az/Alt mit Himmelsrichtung, Infotext), Nachtmodus-Toggle (Rotfilter per CSS-Klasse auf `<html>`), Einstellungen (Linien, Labels, Grid).
- Design: dunkles Nachthimmel-UI (Ground `#0a0e1a`, Karte `#050810`, Text `#e9edf8`, Akzent `#f0c66a`), Systemschrift `-apple-system`, monospace für Koordinaten mit `tabular-nums`, große Touch-Ziele (min. 44 px), keine Emojis in der UI.

## D. PWA/Deploy

- `manifest.webmanifest`: name "Sternenkompass", short_name "Sternenkompass", display "standalone", orientation "portrait", background/theme `#0a0e1a`, Icons 192/512 (PNG, dazu maskable).
- `sw.js`: Cache-first für App-Shell und `data/*.json` mit Versionsstring; Update-Strategie dokumentieren.
- `icons/`: `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` (180) – programmatisch erzeugt (Skript beilegen), Motiv: stilisierte Kompassnadel auf Sternfeld, dunkler Grund.
- `DEPLOY.md`: GitHub-Pages-Schritte für Repo `grillprofi/sternenkompass` inkl. Auto-Enable über `gh-pages`-Branch und manuelle Alternative.

## Abweichungen

- A ergänzt (13.08.2026): `export function precessStarJ2000ToDate(raDeg, decDeg, jd)` in `js/astro.js`. Sternkatalog-Koordinaten (stars.json, J2000) sollen vom Renderer einmalig beim Laden damit auf das Äquinoktium des Datums gebracht werden, bevor sie durch `raDecToAltAz` laufen; sonst entsteht 2026 ein Versatz von ~0,4 Grad gegenüber Planeten/Mond/Sonne. Einmal pro App-Start reicht (Drift < 0,01 Grad pro Woche).
- Deploy (13.08.2026): GitHub Pages läuft im Modus "Deploy from branch: gh-pages". Der Workflow `.github/workflows/pages.yml` im Zielrepo spiegelt `main` automatisch nach `gh-pages`; Releases = Push auf `main`.
