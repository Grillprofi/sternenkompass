# Integrations- und Abnahmeplan V1 (Orchestrator)

Checkliste fuer die Zusammenfuehrung der Teilbereiche A bis E. Wird vom Orchestrator abgearbeitet, sobald B (Daten) und C (Renderer/UI) fertig gemeldet sind.

## 1. Statische Pruefung

- [ ] Alle Contract-Dateien vorhanden (A: astro.js/tests, B: 3x data + tools, C: index.html/css/3x js, D: manifest/sw/icons/DEPLOY, E: search.js/learn.js/tests)
- [ ] `node tests/test-astro.mjs` gruen (54 Faelle)
- [ ] `node tests/test-search.mjs` und `node tests/test-learn.mjs` gruen
- [ ] Datenvalidierung aus B nachvollzogen (88 Sternbilder, HIP-Referenzen vollstaendig)
- [ ] index.html referenziert manifest, apple-touch-icon, sw-Registrierung guarded
- [ ] Kein Verweis auf externe CDNs/Hosts in HTML/JS/CSS (Offline-Pflicht)

## 2. Funktionaler Headless-Test (headless_shell, 390x844)

- [ ] Start mit echten Daten: keine Konsolenfehler, Sternfeld + Horizont + UI sichtbar (Screenshot)
- [ ] Antipp-Picking liefert Info-Panel (per CDP Input.dispatchTouchEvent simulieren)
- [ ] Manueller Modus: Schwenken veraendert Blickrichtung (CDP-Events)
- [ ] Fehlerpfad: data-Datei blockiert -> deutsche Fehlermeldung
- [ ] Plausibilitaet: Mondposition im Render vs. astro.js-Referenzwert des Testzeitpunkts

## 3. Review

- [ ] Review-Agent (Opus) ueber den Gesamtstand: Contract-Treue, offensichtliche Bugs, iOS-Fallstricke (Permission-Gesten, 100vh/safe-area, Touch-Ziele), Performance-Risiken
- [ ] Befunde triagieren: kritisch -> fixen, kosmetisch -> Backlog in Projektnotiz

## 4. Deploy

- [ ] `bash tools/sync-to-repo.sh` (spiegelt nach /workspace/sternenkompass, schont README/.github)
- [ ] Commit + Push auf main -> Workflow spiegelt nach gh-pages -> Pages baut
- [ ] Workflow-Erfolg per GitHub-API pruefen (github.io ist aus der Sandbox nicht abrufbar)
- [ ] CACHE_VERSION in sw.js hochzaehlen bei jedem Folge-Release

## 5. Live-Test mit Adrian (iPhone)

- [ ] URL oeffnen, Sensoren freigeben, Kompassrichtung gegen reale Landmarke pruefen
- [ ] Mond/Planet antippen, Infotexte pruefen
- [ ] Zum Home-Bildschirm hinzufuegen, Offline-Start testen (Flugmodus)
- [ ] Feedback einsammeln -> V2-Planung (Suche/Pfeil-UI, Zeitregler) und V3 (Lernmodi verdrahten)

## Bekannte bewusste Einschraenkungen V1

- Mond geozentrisch (bis ~1 Grad am Horizont), Fix in V2
- Kompass-Genauigkeit iPhone typ. 5 bis 15 Grad, Kalibrierhinweis in der UI
- Milchstrasse, Deep-Sky, ISS, Ereignis-Kalender: V4 laut Projektnotiz
