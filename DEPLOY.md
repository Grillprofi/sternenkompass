# Sternenkompass – Deployment auf GitHub Pages

Ziel-Repo: `grillprofi/sternenkompass`
Ziel-URL: **https://grillprofi.github.io/sternenkompass/**

Die App ist statisch: kein Build-Schritt, keine Dependencies, keine Pipeline nötig.
Alle Pfade in `index.html`, `manifest.webmanifest` und `sw.js` sind relativ (`./…`),
die App läuft deshalb ohne Anpassung im Unterverzeichnis `/sternenkompass/`.

## 1. Repo-Inhalt

Der **Inhalt dieses `app`-Ordners** kommt in das **Repo-Root**, nicht der Ordner selbst.
Im Root des Repos müssen also direkt liegen:

```
index.html
manifest.webmanifest
sw.js
css/style.css
js/astro.js  js/render.js  js/sensors.js  js/app.js
data/stars.json  data/constellations.json  data/objects.json
icons/icon-192.png  icons/icon-512.png  icons/icon-maskable-512.png  icons/apple-touch-icon.png
ARCHITECTURE.md  DEPLOY.md
tools/  tests/          (dürfen mit, stören nicht)
```

Wichtig: `https://grillprofi.github.io/sternenkompass/index.html` muss direkt erreichbar sein.
Läge der `app`-Ordner mit im Repo, wäre die URL `…/sternenkompass/app/` – dann stimmt der
Service-Worker-Scope nicht mehr mit der erwarteten Start-URL überein.

Einmalig hochladen (aus dem `app`-Ordner heraus):

```bash
git init -b main
git add -A
git commit -m "Sternenkompass V1"
git remote add origin https://github.com/grillprofi/sternenkompass.git
git push -u origin main
```

> [!TIP]
> Optional eine leere Datei `.nojekyll` ins Root legen. Dann überspringt GitHub Pages die
> Jekyll-Verarbeitung, der Upload ist etwas schneller und Dateien mit führendem Unterstrich
> würden nicht ausgefiltert.

## 2. GitHub Pages aktivieren (Standardweg)

1. Repo auf github.com öffnen.
2. **Settings** (oben rechts im Repo-Menü).
3. Links in der Seitenleiste **Pages**.
4. Unter **Build and deployment → Source**: **Deploy from a branch** wählen.
5. Unter **Branch**: `main` auswählen, Ordner `/ (root)`, dann **Save**.
6. Ein bis zwei Minuten warten. Oben auf der Pages-Seite erscheint dann
   „Your site is live at https://grillprofi.github.io/sternenkompass/“.

Jeder weitere `git push` auf `main` veröffentlicht automatisch neu.

Dasselbe per CLI, falls `gh` installiert und eingeloggt ist:

```bash
gh api -X POST repos/grillprofi/sternenkompass/pages \
  -f "source[branch]=main" -f "source[path]=/"
gh api repos/grillprofi/sternenkompass/pages --jq .html_url   # Status prüfen
```

## 3. Alternative: `gh-pages`-Branch

Sinnvoll, wenn `main` die Quellen samt `tools/` und `tests/` behalten soll und nur die
Auslieferung getrennt liegen soll. GitHub Pages aktiviert sich für diesen Branch
in vielen Repos automatisch, sonst in Settings → Pages einfach `gh-pages` statt `main` wählen.

Variante A – Branch aus `main` ableiten:

```bash
git checkout -b gh-pages
git push -u origin gh-pages
# danach in Settings -> Pages: Branch = gh-pages, Ordner = / (root)
```

Variante B – leerer, unabhängiger Auslieferungs-Branch:

```bash
git checkout --orphan gh-pages
git rm -rf --cached tools tests            # optional: nur Laufzeitdateien ausliefern
git commit -am "Deploy Sternenkompass"
git push -u origin gh-pages
```

## 4. Nach dem Deploy prüfen

- https://grillprofi.github.io/sternenkompass/ öffnet die App (dunkler Sternhimmel).
- https://grillprofi.github.io/sternenkompass/manifest.webmanifest liefert JSON.
- https://grillprofi.github.io/sternenkompass/sw.js liefert JavaScript.
- Desktop-Chrome: DevTools → **Application → Service Workers** zeigt `activated and is running`,
  unter **Cache Storage** liegt `sternenkompass-v1.0.0` mit App-Shell und `data/*.json`.
- Offline-Test: in DevTools **Offline** anhaken, Seite neu laden – die App muss weiter starten.

## 5. Installation auf dem iPhone

1. Safari öffnen (nicht Chrome), https://grillprofi.github.io/sternenkompass/ aufrufen.
2. Teilen-Symbol (Quadrat mit Pfeil nach oben) antippen.
3. **Zum Home-Bildschirm** wählen, Name bestätigen, **Hinzufügen**.
4. Die App startet ab jetzt vom Home-Bildschirm im Vollbild (`display: standalone`,
   Hochformat), mit dem Kompass-Icon und ohne Safari-Leiste.

> [!IMPORTANT]
> **HTTPS ist Pflicht.** Service Worker, Geolocation und die Bewegungssensoren
> (`DeviceOrientationEvent.requestPermission`) funktionieren nur in einem sicheren Kontext.
> GitHub Pages liefert automatisch über HTTPS aus – die Seite also nie über `http://` aufrufen.
> Ausnahme für lokale Tests: `http://localhost` gilt ebenfalls als sicherer Kontext.
>
> Auf iOS muss die Sensor-Freigabe außerdem aus einer echten Nutzergeste heraus angefragt
> werden (Button in der App), und der Kompass braucht nach dem ersten Start eine kurze
> Kalibrierung (Gerät in einer Acht bewegen).

## 6. Lokal testen

`file://` reicht nicht: ES-Module, `fetch` auf `data/*.json` und der Service Worker
brauchen einen echten HTTP-Server.

```bash
cd app
python3 -m http.server 8000
# dann http://localhost:8000/ im Browser oeffnen
```

## 7. Updates ausliefern

1. Dateien ändern und pushen.
2. **In `sw.js` `CACHE_VERSION` hochzählen** (z. B. `v1.0.0` → `v1.0.1`).
   Ohne diesen Schritt behalten bereits installierte Geräte dauerhaft die alten
   Dateien, weil der Service Worker cache-first arbeitet.
3. Beim nächsten Start lädt der Browser `sw.js` neu, installiert den neuen Cache,
   löscht die alten `sternenkompass-*`-Caches und übernimmt sofort (`skipWaiting`).
4. Auf dem iPhone genügt das Schließen und erneute Öffnen der Home-Bildschirm-App;
   ein Neu-Installieren ist nicht nötig.

Beim Austauschen der Icons vorher neu erzeugen:

```bash
bash icons/make-icons.sh
```

Das Skript rendert `icons/icon.html` mit einem headless Chromium und prüft anschließend
Signatur, Abmessungen, Dateigröße und Deckkraft der erzeugten PNGs.
