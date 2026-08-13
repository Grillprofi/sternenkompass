#!/usr/bin/env bash
#
# Erzeugt die PWA-Icons des Sternenkompass reproduzierbar aus icons/icon.html.
#
# Motiv: stilisierte Kompassnadel auf Sternfeld, Grund #0a0e1a, Akzent #f0c66a.
# Gerendert wird mit einem headless Chromium (Screenshot der Canvas-Seite).
# Keine npm-Pakete, keine Netzverbindung, keine Bildbibliothek noetig.
# Das Sternfeld nutzt einen festen Seed (mulberry32), wiederholte Laeufe
# liefern daher dasselbe Bild.
#
# Aufruf (aus beliebigem Verzeichnis):
#   bash "icons/make-icons.sh"
#   CHROME=/pfad/zu/chrome-oder-headless_shell bash "icons/make-icons.sh"
#
# Ergebnis:
#   icons/icon-192.png            192x192, deckend
#   icons/icon-512.png            512x512, deckend
#   icons/icon-maskable-512.png   512x512, Motiv innerhalb der 80%-Safe-Zone
#   icons/apple-touch-icon.png    180x180, deckend, ohne Alphakanal
#
# Hinweis zu Chromium-Varianten:
#   - "headless_shell" (Playwright) haelt --window-size exakt ein, jede Groesse
#     wird direkt nativ gerendert. Das ist der bevorzugte Weg.
#   - Ein normales Chrome/Chromium mit --headless=new erzwingt eine Mindest-
#     Fensterbreite von 500 px; Groessen darunter kaemen verzerrt heraus.
#     Dafuer gibt es den Fallback: nativ in 512 rendern und anschliessend mit
#     einem kleinen Python-Flaechenfilter (nur zlib, Standardbibliothek) auf
#     192 bzw. 180 herunterrechnen.
#
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---------------------------------------------------------------- Chromium
CHROME="${CHROME:-}"
if [ -z "$CHROME" ]; then
  for cand in \
    /opt/pw-browsers/chromium_headless_shell-*/chrome-linux/headless_shell \
    /opt/pw-browsers/chromium \
    /opt/pw-browsers/chromium-*/chrome-linux/chrome \
    "$(command -v headless_shell || true)" \
    "$(command -v chromium || true)" \
    "$(command -v chromium-browser || true)" \
    "$(command -v google-chrome || true)"
  do
    if [ -n "$cand" ] && [ -x "$cand" ]; then CHROME="$cand"; break; fi
  done
fi
if [ -z "$CHROME" ] || [ ! -x "$CHROME" ]; then
  echo "FEHLER: kein Chromium gefunden. Setze CHROME=/pfad/zu/chrome." >&2
  exit 1
fi

HEADLESS_FLAG="--headless=new"
NATIVE_ANY_SIZE=0
case "$(basename "$CHROME")" in
  headless_shell) HEADLESS_FLAG=""; NATIVE_ANY_SIZE=1 ;;
esac

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# ------------------------------------------------- PNG-Werkzeug (nur stdlib)
cat > "$WORK/pngtool.py" <<'PYTOOL'
"""Minimales PNG-Werkzeug: lesen, flaechenmittelnd verkleinern, schreiben, pruefen.
Nur Standardbibliothek (struct, zlib). Erwartet nicht-interlaced PNGs mit 8 Bit."""
import struct, sys, zlib

SIG = b"\x89PNG\r\n\x1a\n"
BPP = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}


def read_png(path):
    raw = open(path, "rb").read()
    if raw[:8] != SIG:
        raise ValueError("keine PNG-Signatur")
    w, h, depth, ctype, comp, filt, inter = struct.unpack(">IIBBBBB", raw[16:29])
    if depth != 8 or inter != 0 or ctype not in (2, 6):
        raise ValueError("nur 8-Bit RGB/RGBA ohne Interlace unterstuetzt")
    idat, pos = b"", 8
    while pos < len(raw):
        ln = struct.unpack(">I", raw[pos:pos + 4])[0]
        typ = raw[pos + 4:pos + 8]
        if typ == b"IDAT":
            idat += raw[pos + 8:pos + 8 + ln]
        elif typ == b"IEND":
            break
        pos += 12 + ln
    data = zlib.decompress(idat)
    bpp = BPP[ctype]
    stride = w * bpp
    prev = bytearray(stride)
    px = bytearray()
    p = 0
    for _ in range(h):
        ft = data[p]; p += 1
        line = bytearray(data[p:p + stride]); p += stride
        if ft == 1:
            for i in range(bpp, stride):
                line[i] = (line[i] + line[i - bpp]) & 255
        elif ft == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 255
        elif ft == 3:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 255
        elif ft == 4:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                b = prev[i]
                c = prev[i - bpp] if i >= bpp else 0
                q = a + b - c
                pa, pb, pc = abs(q - a), abs(q - b), abs(q - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 255
        elif ft != 0:
            raise ValueError("unbekannter Filtertyp %d" % ft)
        px += line
        prev = line
    return px, w, h, bpp, len(raw)


def write_png(path, px, w, h, bpp):
    ctype = 2 if bpp == 3 else 6
    stride = w * bpp
    body = bytearray()
    for y in range(h):
        body.append(0)                       # Filter 0 (None), deterministisch
        body += px[y * stride:(y + 1) * stride]
    def chunk(typ, data):
        return (struct.pack(">I", len(data)) + typ + data
                + struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF))
    out = bytearray(SIG)
    out += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, ctype, 0, 0, 0))
    out += chunk(b"IDAT", zlib.compress(bytes(body), 9))
    out += chunk(b"IEND", b"")
    open(path, "wb").write(bytes(out))


def downscale(px, w, h, bpp, nw, nh):
    """Kastenfilter mit Flaechenmittel. Nur fuer nw<=w, nh<=h."""
    out = bytearray(nw * nh * bpp)
    stride, nstride = w * bpp, nw * bpp
    for ny in range(nh):
        y0 = ny * h // nh
        y1 = max(y0 + 1, (ny + 1) * h // nh)
        for nx in range(nw):
            x0 = nx * w // nw
            x1 = max(x0 + 1, (nx + 1) * w // nw)
            n = (y1 - y0) * (x1 - x0)
            acc = [0] * bpp
            for y in range(y0, y1):
                base = y * stride + x0 * bpp
                for x in range(x1 - x0):
                    o = base + x * bpp
                    for c in range(bpp):
                        acc[c] += px[o + c]
            o = ny * nstride + nx * bpp
            for c in range(bpp):
                out[o + c] = (acc[c] + n // 2) // n
    return out


def cmd_resize(src, dst, size):
    px, w, h, bpp, _ = read_png(src)
    size = int(size)
    if (w, h) == (size, size):
        write_png(dst, px, w, h, bpp)
    else:
        write_png(dst, downscale(px, w, h, bpp, size, size), size, size, bpp)


def cmd_verify(pairs):
    fail = False
    for name, want in pairs:
        want = int(want)
        try:
            px, w, h, bpp, nbytes = read_png(name)
        except Exception as e:                                   # noqa: BLE001
            print("  FEHLER %-24s %s" % (name.split("/")[-1], e))
            fail = True
            continue
        msgs = []
        if (w, h) != (want, want):
            msgs.append("Abmessung %dx%d statt %dx%d" % (w, h, want, want))
        if nbytes < 1024:
            msgs.append("Datei kleiner als 1 KB")
        colors, minalpha = set(), 255
        stride = w * bpp
        for y in range(0, h, max(1, h // 96)):
            for x in range(0, w, max(1, w // 96)):
                o = y * stride + x * bpp
                colors.add(bytes(px[o:o + 3]))
                if bpp == 4:
                    minalpha = min(minalpha, px[o + 3])
        if len(colors) < 32:
            msgs.append("wirkt leer (nur %d Farben)" % len(colors))
        if minalpha != 255:
            msgs.append("nicht deckend (min. Alpha %d)" % minalpha)
        if msgs:
            fail = True
        print("  %-6s %-24s %dx%d  8 Bit %s  %7d B  Farben=%4d  deckend=%s%s"
              % ("OK" if not msgs else "FEHLER", name.split("/")[-1], w, h,
                 "RGB" if bpp == 3 else "RGBA", nbytes, len(colors),
                 "ja" if minalpha == 255 else "nein",
                 "  -> " + "; ".join(msgs) if msgs else ""))
    return 1 if fail else 0


if __name__ == "__main__":
    if sys.argv[1] == "resize":
        cmd_resize(sys.argv[2], sys.argv[3], sys.argv[4])
    elif sys.argv[1] == "verify":
        a = sys.argv[2:]
        sys.exit(cmd_verify(list(zip(a[0::2], a[1::2]))))
PYTOOL

# ------------------------------------------------------------------ Rendern
url_for() {   # $1 = Canvas-Groesse, $2 = Variante
  python3 - "$DIR/icon.html" "$1" "$2" <<'PY'
import sys, pathlib, urllib.parse
p = pathlib.Path(sys.argv[1]).resolve()
print(p.as_uri() + "?size=" + urllib.parse.quote(sys.argv[2])
      + "&variant=" + urllib.parse.quote(sys.argv[3]))
PY
}

shot() {      # $1 = Ziel-PNG, $2 = Renderkantenlaenge, $3 = Variante
  local out="$1" size="$2" variant="$3"
  rm -f "$out"
  # shellcheck disable=SC2086
  "$CHROME" $HEADLESS_FLAG \
    --no-sandbox \
    --disable-gpu \
    --disable-dev-shm-usage \
    --hide-scrollbars \
    --force-device-scale-factor=1 \
    --force-color-profile=srgb \
    --disable-lcd-text \
    --user-data-dir="$WORK/profile" \
    --default-background-color=00000000 \
    --virtual-time-budget=2000 \
    --window-size="${size},${size}" \
    --screenshot="$out" \
    "$(url_for "$size" "$variant")" >/dev/null 2>&1
  if [ ! -s "$out" ]; then
    echo "FEHLER: $out wurde nicht erzeugt." >&2
    exit 1
  fi
}

make_icon() { # $1 = Ziel-PNG, $2 = Zielgroesse, $3 = Variante
  local out="$1" size="$2" variant="$3"
  if [ "$NATIVE_ANY_SIZE" = "1" ] || [ "$size" -ge 512 ]; then
    shot "$out" "$size" "$variant"
    echo "  $(basename "$out")  ${size}px nativ  ($(wc -c < "$out") Bytes)"
  else
    shot "$WORK/tmp.png" 512 "$variant"
    python3 "$WORK/pngtool.py" resize "$WORK/tmp.png" "$out" "$size"
    echo "  $(basename "$out")  512px gerendert, auf ${size}px gefiltert  ($(wc -c < "$out") Bytes)"
  fi
}

echo "Chromium: $CHROME"
[ "$NATIVE_ANY_SIZE" = "1" ] \
  && echo "Modus:    headless_shell (jede Groesse nativ)" \
  || echo "Modus:    --headless=new (unter 512 px wird heruntergerechnet)"
echo "Rendere Icons ..."
make_icon "$DIR/icon-512.png"          512 standard
make_icon "$DIR/icon-192.png"          192 standard
make_icon "$DIR/icon-maskable-512.png" 512 maskable
make_icon "$DIR/apple-touch-icon.png"  180 standard

echo "Pruefe Ergebnisse (Signatur, IHDR, Groesse, Inhalt, Deckkraft) ..."
python3 "$WORK/pngtool.py" verify \
  "$DIR/icon-192.png" 192 \
  "$DIR/icon-512.png" 512 \
  "$DIR/icon-maskable-512.png" 512 \
  "$DIR/apple-touch-icon.png" 180

echo "Fertig."
