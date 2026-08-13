# Sternenkompass – Datenquellen (Teilbereich B)

Alle Dateien in `data/` werden reproduzierbar durch `node tools/build-data.mjs` erzeugt.
Downloads laufen per `curl` (nutzt den vorkonfigurierten HTTPS-Proxy der Umgebung).

## 1. Sternkatalog: HYG Database v3.8

- Datei: `hyg/v3/hyg_v38.csv.gz` im GitHub-Repo [astronexus/HYG-Database](https://github.com/astronexus/HYG-Database)
- Download-URL: `https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/v3/hyg_v38.csv.gz`
- Stand: v3.8 (Dezember 2023), 119.626 Sterne; Kombination aus Hipparcos, Yale Bright Star Catalog und Gliese.
- Lizenz: Creative Commons Attribution-ShareAlike (HYG 3.x: CC BY-SA 2.5, laut Repo-README; neuere Versionen CC BY-SA 4.0). Namensnennung: David Nash / astronexus.com.
- Hinweis: Das GitHub-Repo ist als Archiv eingefroren (Weiterentwicklung auf Codeberg). Das dortige README nennt HYG v4.1 als aktuelle Version, die zugehörige Datei `hyg/CURRENT/hyg_v41.csv` existiert im GitHub-Repo jedoch nicht (HTTP 404). v3.8 ist die neueste auf GitHub tatsächlich abrufbare Version; die Unterschiede zu v4.1 betreffen laut Changelog nur elf zusätzliche inoffizielle Eigennamen von Doppelstern-Begleitern.
- Verwendete Spalten: `hip`, `proper`, `ra` (Stunden, J2000), `dec` (Grad, J2000), `dist` (Parsec, 100000 = unbekannt), `mag`, `spect`, `ci` (B-V), `bayer`, `con`.

### Transformation zu `data/stars.json`

- Filter: `mag <= 6.0`, Sonne (`id 0`, "Sol") ausgeschlossen.
- Zusätzlich alle Sterne, deren HIP-Nummer in Sternbildlinien referenziert wird, auch wenn schwächer als 6,0 mag.
- Pro HIP-Nummer nur der hellste Katalogeintrag (Doppelstern-Komponenten werden nicht doppelt geführt); Sterne ohne HIP-Nummer bleiben einzeln erhalten (`hip = 0`).
- `raDeg = ra * 15` (J2000, 4 Dezimalstellen), `decDeg` (4 Dezimalstellen), `mag`/`bv` 2 Dezimalstellen.
- `distLj = round(dist * 3.262)`, `0` wenn unbekannt.
- Bayer: HYG-Kürzel ("Alp-2") zu "α² UMa" formatiert; Spektralklasse: erstes Token, max. 10 Zeichen; `con` kleingeschrieben.
- Sortierung nach Helligkeit (hellste zuerst).

## 2. Sternbildlinien: Stellarium "modern" Skyculture

- Datei: `skycultures/modern/constellationship.fab` im GitHub-Repo [Stellarium/stellarium](https://github.com/Stellarium/stellarium), Tag `v24.4`
- Download-URL: `https://raw.githubusercontent.com/Stellarium/stellarium/v24.4/skycultures/modern/constellationship.fab`
- Format: pro Zeile `Kürzel Anzahl HIP-Paar HIP-Paar ...` (Linien als Sternpaare); alle 88 IAU-Sternbilder, Serpens als ein Eintrag mit zwei getrennten Linienzügen.
- Lizenz: Stellarium-Daten stehen unter GPLv2 (oder später). Die Liniendefinitionen werden hier als Faktendaten (welche Sterne verbunden sind) übernommen, nicht als Software eingebunden; Quelle und Herkunft sind hiermit dokumentiert. Ab Stellarium v25 liegen die Skycultures nicht mehr im Hauptrepo, daher der feste Tag `v24.4` (letzter Release mit `.fab`-Format).
- Transformation: aufeinanderfolgende Paare werden zu Polylinien zusammengefasst (Ketten beginnen an Endpunkten mit Grad 1, Zyklen bleiben geschlossene Züge); doppelte Kanten werden entfernt. Jede referenzierte HIP-Nummer ist garantiert in `stars.json` enthalten.

## 3. Namen und Infotexte

- Lateinische Namen und IAU-Kürzel: IAU-Standard (88 Sternbilder), im Skript als Tabelle hinterlegt und gegen `constellation_names.eng.fab` der Stellarium-Skyculture abgeglichen.
- Deutsche Namen: gebräuchliche deutsche Sternbildnamen (u. a. wie im Kosmos Himmelsjahr üblich), als Tabelle im Skript.
- Infotexte (`info` in `constellations.json`, komplette `objects.json`): redaktionell für dieses Projekt erstellt (deutsch, 2 bis 4 bzw. 3 bis 5 Sätze, sachlich, ohne Emojis und ohne Gedankenstriche), erstellt mit KI-Unterstützung in sechs sequentiellen Blöcken zu je etwa 15 Sternbildern (Zwischenstände jeweils sofort nach `data/constellations.json` geschrieben) und auf Faktenfehler geprüft. Die Texte liegen als `INFO`-Tabelle in `tools/build-data.mjs`; fehlt ein Eintrag, setzt das Skript einen sachlichen 1-Satz-Platzhalter, die Validierung schlägt dann an. Keine externe Lizenz nötig.

## 4. Reproduzierbarkeit und Validierung

```
node tools/build-data.mjs             # Download + Build + Validierung
node tools/build-data.mjs --offline   # ohne Netz, nutzt Cache
node tools/build-data.mjs --validate  # nur Abnahmeprüfung der data/*.json
```

- Cache: `$STERNENKOMPASS_CACHE` oder `<tmpdir>/sternenkompass-cache`.
- Validierung (Exit-Code ungleich 0 bei Fehlschlag): JSON-Parse aller drei Dateien; 4500 bis 9000 Sterne; 88 Sternbilder; jede Linien-HIP in `stars.json` vorhanden; `objects.json` mit allen 9 Schlüsseln; Stichproben Polarstern (HIP 11767, RA ≈ 37,95°, Dec ≈ +89,26°) und Sirius (HIP 32349, mag ≈ −1,44); Stilprüfung der Infotexte (Länge, keine Gedankenstriche, keine Emojis).

## Nachbearbeitung 13.08.2026

Die deutschen Textfelder in `constellations.json` (de, info) und `objects.json` wurden nachtraeglich von ae/oe/ue-Schreibweise auf echte Umlaute und kuratierte ss-auf-ß-Faelle umgestellt (Ausnahmen: lateinische Namen wie Carinae, Tucanae, Praesepe, Phaethon, Rasalhague). Die in `build-data.mjs` eingebetteten Ausgangstexte sind davon unberuehrt; bei einem Neubau der Daten muss die Umlaut-Nachbearbeitung wiederholt oder ins Skript uebernommen werden.
