# Sternenkompass

Interaktive Sternenhimmel-Lernapp als Web-App (PWA) fuer das iPhone.

Handy an den Himmel halten: Die App zeigt live eine digitale Karte des Nachthimmels mit Sternen, Planeten, Mond und Sternbildern, gesteuert ueber Kompass und Lagesensoren. Antippen liefert Infos zu jedem Objekt. Geplant sind Objektsuche mit Richtungspfeil, gefuehrte Touren, Quiz und Spaced-Repetition-Lernen sowie Erklaerungen zur Himmelsmechanik.

## Nutzung

- Live-Version: https://grillprofi.github.io/sternenkompass/
- Auf dem iPhone in Safari oeffnen, Teilen-Menue, "Zum Home-Bildschirm" fuer die App-Installation.
- Sensoren (Kompass/Gyroskop) brauchen HTTPS und eine einmalige Freigabe pro Sitzung.

## Technik

Statische Web-App ohne Build-Schritt: reine ES-Module, eigener Astronomie-Kern (Keplerelemente, Meeus-Reihen), Sternkatalog auf HYG-Basis, Sternbildlinien nach Stellarium Western Skyculture. Details: `ARCHITECTURE.md`.
