#!/usr/bin/env node
/**
 * Sternenkompass – Datenpipeline (Teilbereich B)
 *
 * Erzeugt reproduzierbar:
 *   data/stars.json           Sternkatalog (mag <= 6.0 plus alle in Sternbildlinien referenzierten Sterne)
 *   data/constellations.json  88 Sternbilder: Name lat/de, Linien (Polylinien aus HIP), Infotext
 *   data/objects.json         Deutsche Infotexte fuer Sonne, Mond und Planeten
 *
 * Quellen (Details und Lizenzen: tools/DATA_SOURCES.md):
 *   - HYG v3.8 Sternkatalog (astronexus/HYG-Database auf GitHub, CC BY-SA 2.5)
 *   - Stellarium "modern" Skyculture, constellationship.fab (Tag v24.4, GPLv2; als Faktendaten uebernommen)
 *
 * Nutzung:
 *   node tools/build-data.mjs             Download (curl, nutzt HTTPS_PROXY) + Build + Validierung
 *   node tools/build-data.mjs --offline   Kein Download, nutzt vorhandene Dateien im Cache
 *   node tools/build-data.mjs --validate  Nur Validierung der vorhandenen data/*.json
 *
 * Cache-Verzeichnis: $STERNENKOMPASS_CACHE oder <tmpdir>/sternenkompass-cache
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const CACHE_DIR = process.env.STERNENKOMPASS_CACHE || path.join(tmpdir(), "sternenkompass-cache");

const HYG_URL = "https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/v3/hyg_v38.csv.gz";
const FAB_URL = "https://raw.githubusercontent.com/Stellarium/stellarium/v24.4/skycultures/modern/constellationship.fab";
const HYG_FILE = path.join(CACHE_DIR, "hyg_v38.csv.gz");
const FAB_FILE = path.join(CACHE_DIR, "constellationship.fab");

const MAG_LIMIT = 6.0;
const PC_TO_LJ = 3.262; // Parsec -> Lichtjahre (Contract-Formel)
const HYG_DIST_UNKNOWN = 99999; // HYG markiert unbekannte Distanzen mit 100000 pc

// ---------------------------------------------------------------------------
// 88 Sternbilder: IAU-Kuerzel (Schreibweise IAU), lateinischer Name, deutscher Name
// ---------------------------------------------------------------------------

const CONSTELLATIONS = {
  and: { iau: "And", lat: "Andromeda", de: "Andromeda" },
  ant: { iau: "Ant", lat: "Antlia", de: "Luftpumpe" },
  aps: { iau: "Aps", lat: "Apus", de: "Paradiesvogel" },
  aql: { iau: "Aql", lat: "Aquila", de: "Adler" },
  aqr: { iau: "Aqr", lat: "Aquarius", de: "Wassermann" },
  ara: { iau: "Ara", lat: "Ara", de: "Altar" },
  ari: { iau: "Ari", lat: "Aries", de: "Widder" },
  aur: { iau: "Aur", lat: "Auriga", de: "Fuhrmann" },
  boo: { iau: "Boo", lat: "Boötes", de: "Bärenhüter" },
  cae: { iau: "Cae", lat: "Caelum", de: "Grabstichel" },
  cam: { iau: "Cam", lat: "Camelopardalis", de: "Giraffe" },
  cnc: { iau: "Cnc", lat: "Cancer", de: "Krebs" },
  cvn: { iau: "CVn", lat: "Canes Venatici", de: "Jagdhunde" },
  cma: { iau: "CMa", lat: "Canis Major", de: "Großer Hund" },
  cmi: { iau: "CMi", lat: "Canis Minor", de: "Kleiner Hund" },
  cap: { iau: "Cap", lat: "Capricornus", de: "Steinbock" },
  car: { iau: "Car", lat: "Carina", de: "Kiel des Schiffs" },
  cas: { iau: "Cas", lat: "Cassiopeia", de: "Kassiopeia" },
  cen: { iau: "Cen", lat: "Centaurus", de: "Zentaur" },
  cep: { iau: "Cep", lat: "Cepheus", de: "Kepheus" },
  cet: { iau: "Cet", lat: "Cetus", de: "Walfisch" },
  cha: { iau: "Cha", lat: "Chamaeleon", de: "Chamäleon" },
  cir: { iau: "Cir", lat: "Circinus", de: "Zirkel" },
  col: { iau: "Col", lat: "Columba", de: "Taube" },
  com: { iau: "Com", lat: "Coma Berenices", de: "Haar der Berenike" },
  cra: { iau: "CrA", lat: "Corona Australis", de: "Südliche Krone" },
  crb: { iau: "CrB", lat: "Corona Borealis", de: "Nördliche Krone" },
  crv: { iau: "Crv", lat: "Corvus", de: "Rabe" },
  crt: { iau: "Crt", lat: "Crater", de: "Becher" },
  cru: { iau: "Cru", lat: "Crux", de: "Kreuz des Südens" },
  cyg: { iau: "Cyg", lat: "Cygnus", de: "Schwan" },
  del: { iau: "Del", lat: "Delphinus", de: "Delfin" },
  dor: { iau: "Dor", lat: "Dorado", de: "Schwertfisch" },
  dra: { iau: "Dra", lat: "Draco", de: "Drache" },
  equ: { iau: "Equ", lat: "Equuleus", de: "Füllen" },
  eri: { iau: "Eri", lat: "Eridanus", de: "Eridanus" },
  for: { iau: "For", lat: "Fornax", de: "Chemischer Ofen" },
  gem: { iau: "Gem", lat: "Gemini", de: "Zwillinge" },
  gru: { iau: "Gru", lat: "Grus", de: "Kranich" },
  her: { iau: "Her", lat: "Hercules", de: "Herkules" },
  hor: { iau: "Hor", lat: "Horologium", de: "Pendeluhr" },
  hya: { iau: "Hya", lat: "Hydra", de: "Wasserschlange" },
  hyi: { iau: "Hyi", lat: "Hydrus", de: "Kleine Wasserschlange" },
  ind: { iau: "Ind", lat: "Indus", de: "Inder" },
  lac: { iau: "Lac", lat: "Lacerta", de: "Eidechse" },
  leo: { iau: "Leo", lat: "Leo", de: "Löwe" },
  lmi: { iau: "LMi", lat: "Leo Minor", de: "Kleiner Löwe" },
  lep: { iau: "Lep", lat: "Lepus", de: "Hase" },
  lib: { iau: "Lib", lat: "Libra", de: "Waage" },
  lup: { iau: "Lup", lat: "Lupus", de: "Wolf" },
  lyn: { iau: "Lyn", lat: "Lynx", de: "Luchs" },
  lyr: { iau: "Lyr", lat: "Lyra", de: "Leier" },
  men: { iau: "Men", lat: "Mensa", de: "Tafelberg" },
  mic: { iau: "Mic", lat: "Microscopium", de: "Mikroskop" },
  mon: { iau: "Mon", lat: "Monoceros", de: "Einhorn" },
  mus: { iau: "Mus", lat: "Musca", de: "Fliege" },
  nor: { iau: "Nor", lat: "Norma", de: "Winkelmaß" },
  oct: { iau: "Oct", lat: "Octans", de: "Oktant" },
  oph: { iau: "Oph", lat: "Ophiuchus", de: "Schlangenträger" },
  ori: { iau: "Ori", lat: "Orion", de: "Orion" },
  pav: { iau: "Pav", lat: "Pavo", de: "Pfau" },
  peg: { iau: "Peg", lat: "Pegasus", de: "Pegasus" },
  per: { iau: "Per", lat: "Perseus", de: "Perseus" },
  phe: { iau: "Phe", lat: "Phoenix", de: "Phönix" },
  pic: { iau: "Pic", lat: "Pictor", de: "Maler" },
  psc: { iau: "Psc", lat: "Pisces", de: "Fische" },
  psa: { iau: "PsA", lat: "Piscis Austrinus", de: "Südlicher Fisch" },
  pup: { iau: "Pup", lat: "Puppis", de: "Achterdeck des Schiffs" },
  pyx: { iau: "Pyx", lat: "Pyxis", de: "Schiffskompass" },
  ret: { iau: "Ret", lat: "Reticulum", de: "Netz" },
  sge: { iau: "Sge", lat: "Sagitta", de: "Pfeil" },
  sgr: { iau: "Sgr", lat: "Sagittarius", de: "Schütze" },
  sco: { iau: "Sco", lat: "Scorpius", de: "Skorpion" },
  scl: { iau: "Scl", lat: "Sculptor", de: "Bildhauer" },
  sct: { iau: "Sct", lat: "Scutum", de: "Schild" },
  ser: { iau: "Ser", lat: "Serpens", de: "Schlange" },
  sex: { iau: "Sex", lat: "Sextans", de: "Sextant" },
  tau: { iau: "Tau", lat: "Taurus", de: "Stier" },
  tel: { iau: "Tel", lat: "Telescopium", de: "Fernrohr" },
  tri: { iau: "Tri", lat: "Triangulum", de: "Dreieck" },
  tra: { iau: "TrA", lat: "Triangulum Australe", de: "Südliches Dreieck" },
  tuc: { iau: "Tuc", lat: "Tucana", de: "Tukan" },
  uma: { iau: "UMa", lat: "Ursa Major", de: "Großer Bär" },
  umi: { iau: "UMi", lat: "Ursa Minor", de: "Kleiner Bär" },
  vel: { iau: "Vel", lat: "Vela", de: "Segel des Schiffs" },
  vir: { iau: "Vir", lat: "Virgo", de: "Jungfrau" },
  vol: { iau: "Vol", lat: "Volans", de: "Fliegender Fisch" },
  vul: { iau: "Vul", lat: "Vulpecula", de: "Fuchs" },
};

// ---------------------------------------------------------------------------
// Infotexte fuer die 88 Sternbilder (Deutsch, 2 bis 4 Saetze)
// ---------------------------------------------------------------------------

const INFO = {
  and: "Andromeda schliesst als geschwungene Sternenkette an das Herbstviereck des Pegasus an, ihre hellsten Sterne sind Alpheratz, Mirach und Almach. In ihr liegt die Andromedagalaxie M31, das fernste mit blossem Auge sichtbare Objekt in rund 2,5 Millionen Lichtjahren Entfernung. In der griechischen Mythologie ist Andromeda die Koenigstochter, die an einen Felsen gekettet und von Perseus gerettet wurde. Von Deutschland aus steht sie in den Herbstmonaten abends hoch am Himmel.",
  ant: "Die Luftpumpe ist ein kleines, unscheinbares Sternbild suedlich der Wasserschlange, dessen hellster Stern nur die Groessenklasse 4,3 erreicht. Es wurde im 18. Jahrhundert von Nicolas Louis de Lacaille eingefuehrt und nach der damals neu erfundenen Vakuumpumpe benannt. Von Deutschland aus ist es an Fruehlingsabenden nur tief ueber dem Suedhorizont und unter sehr guten Bedingungen auszumachen.",
  aps: "Der Paradiesvogel ist ein lichtschwaches Sternbild nahe dem suedlichen Himmelspol, sein hellster Stern erreicht nur die Groessenklasse 3,8. Es wurde Ende des 16. Jahrhunderts nach den Beobachtungen der niederlaendischen Seefahrer Keyser und de Houtman eingefuehrt und nach den prachtvollen Paradiesvoegeln Neuguineas benannt. Von Deutschland aus ist es niemals sichtbar.",
  aql: "Der Adler liegt mitten im Band der Milchstrasse, sein Hauptstern Atair bildet mit Wega und Deneb das grosse Sommerdreieck. Atair ist mit knapp 17 Lichtjahren Entfernung einer der naechsten hellen Sterne und wird von Tarazed und Alshain flankiert, was die Figur leicht erkennbar macht. In der griechischen Mythologie traegt der Adler die Blitze des Zeus. Von Deutschland aus steht er an Sommerabenden hoch im Sueden.",
  aqr: "Der Wassermann ist ein ausgedehntes, aber lichtschwaches Tierkreissternbild, dessen hellste Sterne Sadalsuud und Sadalmelik nur etwa die Groessenklasse 2,9 erreichen. Erkennbar ist vor allem der kleine Wasserkrug, eine y-foermige Sterngruppe um Zeta Aquarii. Das Sternbild geht auf babylonische Darstellungen eines Wassergottes zurueck. Von Deutschland aus steht es an Herbstabenden ziemlich tief im Sueden.",
  ara: "Der Altar liegt suedlich des Skorpions im Band der Milchstrasse, seine hellsten Sterne erreichen etwa die Groessenklasse 2,8. Es ist ein antikes Sternbild: Auf diesem Altar sollen die griechischen Goetter vor dem Kampf gegen die Titanen ihren Schwur geleistet haben. Von Deutschland aus bleibt der Altar stets unter dem Horizont.",
  ari: "Der Widder ist ein kleines Tierkreissternbild, das vor allem durch die kurze Sternreihe aus Hamal, Sheratan und Mesarthim auffaellt, wobei Hamal die Groessenklasse 2,0 erreicht. In der griechischen Mythologie steht der Widder fuer das Tier mit dem Goldenen Vlies, das Phrixos rettete. Von Deutschland aus ist er an Herbst- und fruehen Winterabenden gut zu sehen.",
  aur: "Der Fuhrmann bildet ein auffaelliges Fuenfeck, an dessen Nordecke die gelbliche Capella steht, mit Groessenklasse 0,1 einer der hellsten Sterne des Nordhimmels. Suedlich von Capella markiert das kleine Dreieck der Zicklein die Figur zusaetzlich. Das Sternbild wird meist mit dem attischen Wagenlenker Erichthonios verbunden. Von Deutschland aus steht es an Winterabenden fast im Zenit, Capella ist hier sogar zirkumpolar.",
  boo: "Der Baerenhueter erinnert an einen grossen Drachen aus Sternen, an dessen Fusspunkt der orangefarbene Arktur leuchtet, mit Groessenklasse 0,0 der hellste Stern des noerdlichen Sternenhimmels. Man findet ihn leicht, indem man den Deichselbogen des Grossen Wagens verlaengert. Der Name bedeutet Ochsentreiber oder Baerenhueter, der Figur nach folgt er dem Grossen Baeren am Himmel. Beste Sichtbarkeit von Deutschland aus in den Fruehlings- und Fruehsommermonaten.",
  cae: "Der Grabstichel ist eines der kleinsten und lichtschwaechsten Sternbilder, sein hellster Stern erreicht nur die Groessenklasse 4,4. Lacaille fuehrte es im 18. Jahrhundert ein und benannte es nach einem Graveurwerkzeug. Von Deutschland aus erhebt es sich an Winterabenden hoechstens wenige Grad ueber den Suedhorizont und ist praktisch nicht zu beobachten.",
  cam: "Die Giraffe fuellt die grosse, sternarme Region zwischen Polarstern, Fuhrmann und Perseus, ihr hellster Stern Beta Camelopardalis erreicht nur die Groessenklasse 4,0. Das Sternbild wurde 1612 von Petrus Plancius eingefuehrt und traegt keine antike Mythologie. Von Deutschland aus ist es zirkumpolar, also in jeder klaren Nacht ueber dem Horizont, wegen seiner schwachen Sterne aber nur bei dunklem Himmel zu erkennen.",
  cnc: "Der Krebs ist das lichtschwaechste Tierkreissternbild und liegt unauffaellig zwischen den Zwillingen und dem Loewen. Sein Schmuckstueck ist der offene Sternhaufen Praesepe M44, der bei dunklem Himmel schon mit blossem Auge als Nebelfleckchen erscheint. In der Mythologie ist es der Krebs, der Herakles im Kampf gegen die Hydra in die Ferse zwickte. Von Deutschland aus steht er an spaeten Winter- und Fruehlingsabenden hoch im Sueden.",
  cvn: "Die Jagdhunde liegen unter der Deichsel des Grossen Wagens und bestehen im Wesentlichen aus zwei Sternen, dem hellsten mit Cor Caroli, Herz Karls, von Groessenklasse 2,9. Das Sternbild wurde im 17. Jahrhundert von Johannes Hevelius eingefuehrt und stellt die Hunde des Baerenhueters dar. Es enthaelt die bekannte Whirlpool-Galaxie M51 und den Kugelsternhaufen M3. Von Deutschland aus steht es an Fruehlingsabenden sehr hoch am Himmel.",
  cma: "Der Grosse Hund traegt mit Sirius den hellsten Fixstern des gesamten Nachthimmels, sein blauweisses Funkeln von Groessenklasse minus 1,4 ist unverwechselbar. Man findet ihn, indem man die drei Guertelsterne des Orion nach links unten verlaengert. Das Sternbild gilt seit der Antike als einer der Jagdhunde des Orion. Von Deutschland aus steht es an Winterabenden tief im Sueden.",
  cmi: "Der Kleine Hund besteht praktisch nur aus zwei Sternen: dem hellen Prokyon mit Groessenklasse 0,4 und dem deutlich schwaecheren Gomeisa. Prokyon bildet zusammen mit Sirius und Beteigeuze das markante Winterdreieck und ist nur gut elf Lichtjahre entfernt. Der Name Prokyon bedeutet Vorhund, weil er kurz vor Sirius aufgeht. Beste Sichtbarkeit von Deutschland aus an Winter- und Vorfruehlingsabenden.",
  cap: "Der Steinbock ist ein lichtschwaches Tierkreissternbild, dessen Sterne ein flaches Dreieck bilden, die hellsten sind Deneb Algedi und Dabih mit knapp Groessenklasse 3. Die Figur der Ziege mit Fischschwanz geht bis auf babylonische Darstellungen zurueck und wird in der griechischen Mythologie mit dem Hirtengott Pan verbunden. Von Deutschland aus steht er an Spaetsommer- und Herbstabenden tief im Sueden.",
  car: "Der Kiel des Schiffs ist ein praechtiges Sternbild des Suedhimmels und enthaelt mit Canopus den zweithellsten Stern des Nachthimmels von Groessenklasse minus 0,7. Er entstand, als das riesige antike Sternbild Schiff Argo im 18. Jahrhundert in Kiel, Achterdeck und Segel aufgeteilt wurde. Bekannt ist auch der Carinanebel um den instabilen Riesenstern Eta Carinae. Von Deutschland aus ist der Kiel nicht sichtbar.",
  cas: "Kassiopeia ist mit ihrem markanten Himmels-W aus fuenf hellen Sternen eines der bekanntesten Sternbilder des Nordhimmels, die hellsten sind Schedar und Caph mit gut Groessenklasse 2. Sie liegt mitten in der Milchstrasse und steht dem Grossen Wagen genau gegenueber am Himmelspol. In der Mythologie ist Kassiopeia die eitle Koenigin und Mutter der Andromeda. Von Deutschland aus ist sie zirkumpolar und in jeder klaren Nacht zu sehen.",
  cen: "Der Zentaur ist ein grosses, helles Sternbild des Suedhimmels mit Alpha Centauri, dem mit 4,3 Lichtjahren naechstgelegenen Sternsystem, und dem blauweissen Hadar. Er enthaelt ausserdem Omega Centauri, den hellsten Kugelsternhaufen des Himmels. Dargestellt ist der weise Kentaur Cheiron der griechischen Sage. Von Deutschland aus sind nur die noerdlichsten Auslaeufer des Sternbilds zu sehen, die hellen Hauptsterne bleiben unter dem Horizont.",
  cep: "Kepheus liegt zwischen Kassiopeia und dem Polarstern und aehnelt einem Haus mit spitzem Dach, sein hellster Stern Alderamin erreicht Groessenklasse 2,5. Bekannt ist der Ueberriese Delta Cephei, Prototyp der pulsierenden Cepheiden, mit denen Entfernungen im Weltall gemessen werden, sowie der tiefrote Granatstern My Cephei. In der Mythologie ist Kepheus der Koenig von Aethiopien, Gatte der Kassiopeia und Vater der Andromeda. Von Deutschland aus ist er zirkumpolar.",
  cet: "Der Walfisch ist ein ausgedehntes, eher lichtschwaches Sternbild am Herbsthimmel suedlich von Widder und Fischen, seine hellsten Sterne sind Deneb Kaitos und Menkar. Beruehmt ist Mira, ein pulsierender Riesenstern, dessen Helligkeit in elf Monaten zwischen blosser Augensichtbarkeit und tiefer Unsichtbarkeit schwankt. In der Mythologie ist der Walfisch das Seeungeheuer, dem Andromeda geopfert werden sollte. Von Deutschland aus steht er an Herbstabenden im Sueden.",
  cha: "Das Chamaeleon ist ein kleines, lichtschwaches Sternbild nahe dem suedlichen Himmelspol, seine hellsten Sterne erreichen nur gut Groessenklasse 4. Es wurde Ende des 16. Jahrhunderts nach den Beobachtungen niederlaendischer Seefahrer eingefuehrt und nach dem farbwechselnden Kriechtier benannt. Von Deutschland aus ist es niemals sichtbar.",
  cir: "Der Zirkel ist ein sehr kleines Sternbild des Suedhimmels neben Alpha Centauri, sein hellster Stern erreicht nur Groessenklasse 3,2. Lacaille fuehrte es im 18. Jahrhundert ein und benannte es nach dem Zeichenzirkel der Geometer. Von Deutschland aus bleibt es stets unter dem Horizont.",
  col: "Die Taube ist ein kleines Sternbild suedlich von Hase und Grossem Hund, ihre hellsten Sterne Phact und Wazn erreichen etwa Groessenklasse 2,6 und 3,1. Eingefuehrt wurde sie im 16. Jahrhundert von Petrus Plancius als Taube des Noah mit dem Oelzweig. Von Deutschland aus ist sie an Winterabenden nur tief ueber dem Suedhorizont zu sehen.",
  com: "Das Haar der Berenike ist ein zartes Sternbild aus lauter schwachen Sternen zwischen Loewe und Baerenhueter, auffaellig ist vor allem der ausgedehnte offene Sternhaufen Melotte 111, der bei dunklem Himmel wie ein feiner Schleier wirkt. Der Name erinnert an die aegyptische Koenigin Berenike, die ihr Haar den Goettern opferte. Das Sternbild ist reich an Galaxien des Virgo-Haufens. Beste Sichtbarkeit von Deutschland aus an Fruehlingsabenden hoch im Sueden.",
  cra: "Die Suedliche Krone ist ein kleiner, zierlicher Sternenbogen direkt unter dem Schuetzen, ihre Sterne erreichen hoechstens Groessenklasse 4,1. Schon Ptolemaeus fuehrte sie als Kranz zu Fuessen des Schuetzen. Von Deutschland aus ist sie an Sommerabenden nur ganz knapp und unvollstaendig ueber dem Suedhorizont auszumachen.",
  crb: "Die Noerdliche Krone ist ein kleiner, aber sehr einpraegsamer Halbkreis aus Sternen zwischen Baerenhueter und Herkules, ihr hellster Stern Gemma erreicht Groessenklasse 2,2. In der griechischen Mythologie ist sie der Brautkranz der Ariadne, den Dionysos an den Himmel setzte. Von Deutschland aus steht sie an Fruehlings- und Sommerabenden hoch am Himmel.",
  crv: "Der Rabe ist ein kompaktes Viereck aus vier Sternen um Groessenklasse 2,6 bis 3,0 suedwestlich der hellen Spica, das trotz maessiger Helligkeit gut auffaellt. In der griechischen Sage ist es der Rabe des Apollon, der wegen einer Luege an den Himmel verbannt wurde. Von Deutschland aus ist er an Fruehlingsabenden ueber dem Suedhorizont zu sehen.",
  crt: "Der Becher ist ein lichtschwaches Sternbild auf dem Ruecken der Wasserschlange westlich des Raben, seine Sterne bilden eine Kelchform und erreichen hoechstens Groessenklasse 3,6. In der Mythologie gehoert der Becher zur Geschichte des Raben des Apollon. Von Deutschland aus ist er an Fruehlingsabenden tief im Sueden bei dunklem Himmel erkennbar.",
  cru: "Das Kreuz des Suedens ist das kleinste aller 88 Sternbilder und zugleich eines der beruehmtesten: Vier helle Sterne, darunter Acrux und Mimosa mit Groessenklasse 0,8 und 1,3, bilden das kompakte Kreuz, das auf mehreren Nationalflaggen erscheint. Seine Laengsachse weist ungefaehr zum suedlichen Himmelspol, daneben liegt die dunkle Kohlensackwolke. Von Deutschland aus ist es niemals sichtbar.",
  cyg: "Der Schwan fliegt mit weit ausgebreiteten Schwingen entlang der Milchstrasse, seine Figur wird wegen der Form auch Kreuz des Nordens genannt. Der Hauptstern Deneb im Schwanz gehoert zum Sommerdreieck und ist ein extrem leuchtkraeftiger Ueberriese, der Kopfstern Albireo gilt im Fernrohr als schoenster Farbdoppelstern des Himmels. In der Mythologie verwandelte sich Zeus in einen Schwan. Von Deutschland aus steht er an Sommer- und Herbstabenden fast im Zenit.",
  del: "Der Delfin ist ein kleines, aber huebsches Sternbild oestlich des Sommerdreiecks: Vier Sterne um Groessenklasse 4 bilden einen kompakten Rhombus, den springenden Koerper, ein weiterer den Schwanz. In der griechischen Sage rettete ein Delfin den Saenger Arion aus dem Meer. Von Deutschland aus ist er an Sommer- und Fruehherbstabenden hoch im Sueden zu finden.",
  dor: "Der Schwertfisch ist ein lichtschwaches Sternbild des Suedhimmels, beruehmt ist er vor allem, weil in ihm der groesste Teil der Grossen Magellanschen Wolke liegt, einer Begleitgalaxie der Milchstrasse mit dem riesigen Tarantelnebel. Eingefuehrt wurde er Ende des 16. Jahrhunderts nach den Fahrten niederlaendischer Seefahrer, gemeint ist eigentlich der Goldmakrelenfisch Dorado. Von Deutschland aus ist er niemals sichtbar.",
  dra: "Der Drache windet sich mit einer langen Sternenkette zwischen Grossem und Kleinem Baeren um den noerdlichen Himmelspol, sein hellster Stern Etamin im Drachenkopf erreicht Groessenklasse 2,2. Der Stern Thuban war vor rund 4700 Jahren der Polarstern der alten Aegypter. In der griechischen Mythologie bewachte der Drache Ladon die goldenen Aepfel der Hesperiden. Von Deutschland aus ist er zirkumpolar und die ganze Nacht ueber dem Horizont.",
  equ: "Das Fuellen ist nach dem Kreuz des Suedens das zweitkleinste Sternbild und besteht nur aus wenigen schwachen Sternen westlich des Pegasuskopfes, der hellste erreicht Groessenklasse 3,9. Schon Ptolemaeus fuehrte es als Pferdekopf, gedeutet wird es unter anderem als Celeris, Bruder des Pegasus. Von Deutschland aus steht es an Spaetsommer- und Herbstabenden im Sueden, faellt aber kaum auf.",
  eri: "Eridanus ist ein sehr langes Sternbild, das sich als gewundener Himmelsfluss vom Fuss des Orion weit nach Sueden zieht. Sein hellster Stern Achernar, das Flussende, erreicht Groessenklasse 0,5, bleibt von Deutschland aus aber ebenso unsichtbar wie der ganze Suedteil des Flusses. In der Mythologie stuerzte Phaethon mit dem Sonnenwagen in diesen Strom. Der Nordteil ist an Winterabenden westlich des Orion zu verfolgen.",
  for: "Der Chemische Ofen ist ein unscheinbares Sternbild in einer Flussschleife des Eridanus, sein hellster Stern erreicht nur Groessenklasse 3,9. Lacaille benannte es im 18. Jahrhundert zu Ehren der Chemie nach einem Laborofen. Bekannt ist der Fornax-Galaxienhaufen mit vielen Teleskopobjekten. Von Deutschland aus ist es an Herbst- und Winterabenden nur tief ueber dem Suedhorizont zu sehen.",
  gem: "Die Zwillinge sind ein markantes Wintersternbild: Zwei fast parallele Sternketten enden in den hellen Koepfen Castor und Pollux, wobei der orangefarbene Pollux mit Groessenklasse 1,1 etwas heller ist als der weisse Castor. In der griechischen Mythologie sind es die unzertrennlichen Brueder Kastor und Polydeukes, die Dioskuren. Aus diesem Sternbild scheinen im Dezember die Geminiden-Sternschnuppen zu kommen. Von Deutschland aus stehen sie an Winterabenden hoch im Sueden.",
  gru: "Der Kranich ist ein Sternbild des Suedhimmels unterhalb des Suedlichen Fisches, sein hellster Stern Alnair erreicht Groessenklasse 1,7. Er wurde Ende des 16. Jahrhunderts nach den Beobachtungen der niederlaendischen Seefahrer Keyser und de Houtman eingefuehrt und nach dem langhalsigen Vogel benannt. Von Deutschland aus bleibt er praktisch vollstaendig unter dem Horizont.",
  her: "Herkules ist ein grosses, aber nur maessig helles Sternbild zwischen Noerdlicher Krone und Leier, erkennbar am zentralen Viereck der Figur, dem sogenannten Keystone. An dessen Westkante steht der Kugelsternhaufen M13, der schoenste des Nordhimmels, bei dunklem Himmel schon im Fernglas auffaellig. Das Sternbild stellt den Helden Herakles dar, der kopfueber am Himmel kniet. Von Deutschland aus steht es an Sommerabenden sehr hoch am Himmel.",
  hor: "Die Pendeluhr ist ein langgestrecktes, sehr lichtschwaches Sternbild des Suedhimmels am Rand des Eridanus, ihr hellster Stern erreicht nur Groessenklasse 3,9. Lacaille fuehrte sie im 18. Jahrhundert zu Ehren der Praezisionsuhrmacher ein. Von Deutschland aus ist sie nicht zu beobachten.",
  hya: "Die Wasserschlange ist das flaechengroesste aller 88 Sternbilder und erstreckt sich ueber mehr als ein Viertel des Himmels vom Krebs bis zur Waage. Ihr einziger hellerer Stern ist der orangefarbene Alphard, das Einsame Herz, mit Groessenklasse 2,0. In der Mythologie ist sie die vielkoepfige Hydra, die Herakles besiegte. Von Deutschland aus zieht sie an Fruehlingsabenden flach ueber den Suedhorizont.",
  hyi: "Die Kleine Wasserschlange ist ein lichtschwaches Sternbild zwischen den beiden Magellanschen Wolken nahe dem suedlichen Himmelspol, ihr hellster Stern erreicht Groessenklasse 2,8. Sie wurde Ende des 16. Jahrhunderts nach den Fahrten niederlaendischer Seefahrer eingefuehrt und ist vom antiken Sternbild Wasserschlange zu unterscheiden. Von Deutschland aus ist sie niemals sichtbar.",
  ind: "Der Inder ist ein unauffaelliges Sternbild des Suedhimmels zwischen Kranich und Pfau, sein hellster Stern erreicht Groessenklasse 3,1. Eingefuehrt wurde es Ende des 16. Jahrhunderts nach den grossen Entdeckungsfahrten, dargestellt ist die Figur eines indigenen Menschen mit Pfeilen. Bekannt ist Epsilon Indi, einer der sonnennaechsten sonnenaehnlichen Sterne. Von Deutschland aus bleibt der Inder stets unter dem Horizont.",
  lac: "Die Eidechse ist ein kleines Sternbild zwischen Schwan, Kepheus und Andromeda, dessen schwache Sterne eine Zickzacklinie wie ein kleines W bilden, der hellste erreicht Groessenklasse 3,8. Johannes Hevelius fuehrte sie im 17. Jahrhundert ein, eine antike Mythologie gibt es nicht. Von Deutschland aus steht sie an Herbstabenden hoch am Himmel und ist bei dunklem Himmel gut zu verfolgen.",
  leo: "Der Loewe ist eines der wenigen Tierkreissternbilder, das seinem Namen wirklich aehnelt: Kopf und Brust bilden eine markante Sichel wie ein spiegelverkehrtes Fragezeichen, an deren Fusspunkt der helle Regulus mit Groessenklasse 1,4 steht, das Hinterteil endet im Stern Denebola. In der griechischen Mythologie ist es der Nemeische Loewe, den Herakles bezwang. Im November scheinen aus ihm die Leoniden-Sternschnuppen zu kommen. Von Deutschland aus steht er an Fruehlingsabenden hoch im Sueden.",
  lmi: "Der Kleine Loewe ist ein unscheinbares Sternbild zwischen dem Grossen Loewen und dem Grossen Baeren, sein hellster Stern erreicht nur Groessenklasse 3,8. Johannes Hevelius fuegte ihn im 17. Jahrhundert als Lueckenfueller ein, eine antike Sage gehoert nicht zu ihm. Durch eine historische Nachlaessigkeit traegt sein hellster Stern keinen Bayer-Buchstaben Alpha. Von Deutschland aus ist er an Fruehlingsabenden hoch am Himmel, aber nur bei dunklem Himmel erkennbar.",
  lep: "Der Hase kauert als kompaktes Sternbild direkt unter den Fuessen des Orion, seine hellsten Sterne Arneb und Nihal erreichen Groessenklasse 2,6 und 2,8. Nach antiker Deutung ist es der Hase, den Orion mit seinen Hunden jagt. Bekannt ist der tiefrote Kohlenstoffstern R Leporis, Hinds Karmesinstern. Von Deutschland aus ist der Hase an Winterabenden ueber dem Suedhorizont gut zu sehen.",
  lib: "Die Waage ist ein eher unauffaelliges Tierkreissternbild zwischen Jungfrau und Skorpion, ihre hellsten Sterne Zubeneschamali und Zubenelgenubi erreichen etwa Groessenklasse 2,6 und 2,8. Die arabischen Namen bedeuten noerdliche und suedliche Schere, denn die Sterne galten in der Antike als Scheren des Skorpions, ehe die Roemer die Waage als Zeichen der Gerechtigkeit abtrennten. Von Deutschland aus steht sie an Fruehsommerabenden tief im Sueden.",
  lup: "Der Wolf ist ein Sternbild des Suedhimmels zwischen Zentaur und Skorpion mit mehreren Sternen der zweiten und dritten Groessenklasse. Schon in der Antike wurde er als wildes Tier dargestellt, das der Zentaur auf seiner Lanze traegt. Im Jahr 1006 leuchtete in ihm die hellste jemals beobachtete Supernova auf. Von Deutschland aus sind hoechstens seine noerdlichsten Sterne knapp ueber dem Suedhorizont zu erahnen.",
  lyn: "Der Luchs fuellt das grosse, sternarme Feld zwischen Grossem Baeren, Fuhrmann und Zwillingen, sein hellster Stern erreicht Groessenklasse 3,1. Hevelius fuehrte ihn im 17. Jahrhundert ein und bemerkte, man brauche Luchsaugen, um ihn zu erkennen. Von Deutschland aus steht er an Winter- und Fruehlingsabenden sehr hoch am Himmel, seine schwachen Sterne erfordern aber einen dunklen Landhimmel.",
  lyr: "Die Leier ist klein, aber unverkennbar: Neben der strahlend weissen Wega, mit Groessenklasse 0,0 einem der hellsten Sterne des Himmels, haengt ein zierliches Parallelogramm aus schwaecheren Sternen. Wega bildet mit Deneb und Atair das Sommerdreieck und ist nur 25 Lichtjahre entfernt. In der Mythologie ist es die Leier des Saengers Orpheus. Von Deutschland aus steht sie an Sommerabenden nahezu im Zenit.",
  men: "Der Tafelberg ist das lichtschwaechste aller 88 Sternbilder, sein hellster Stern erreicht nur etwa Groessenklasse 5. Lacaille benannte ihn im 18. Jahrhundert nach dem Tafelberg am Kap der Guten Hoffnung, ein Teil der Grossen Magellanschen Wolke ragt wie eine Wolkendecke ueber ihn. Er liegt nahe dem suedlichen Himmelspol und ist von Deutschland aus niemals sichtbar.",
  mic: "Das Mikroskop ist ein sehr unauffaelliges Sternbild suedlich des Steinbocks, dessen hellste Sterne nur knapp die fuenfte Groessenklasse erreichen. Lacaille fuehrte es im 18. Jahrhundert zu Ehren der Wissenschaftsinstrumente ein. Von Deutschland aus steht es an Spaetsommerabenden nur wenige Grad ueber dem Suedhorizont und ist kaum zu beobachten.",
  mon: "Das Einhorn liegt mitten im Winterdreieck zwischen Orion, Sirius und Prokyon, seine Sterne sind unscheinbar, doch die Milchstrasse durchzieht es mit Sternhaufen und Nebeln wie dem Rosettennebel. Eingefuehrt wurde es im 17. Jahrhundert von Petrus Plancius als das Fabeltier der biblischen Ueberlieferung. Von Deutschland aus steht es an Winterabenden im Sueden, braucht aber dunklen Himmel.",
  mus: "Die Fliege ist ein kleines Sternbild direkt suedlich des Kreuzes des Suedens, ihr hellster Stern erreicht Groessenklasse 2,7. Sie wurde Ende des 16. Jahrhunderts nach den Beobachtungen der niederlaendischen Seefahrer Keyser und de Houtman eingefuehrt und ist das einzige Sternbild, das ein Insekt darstellt. Von Deutschland aus ist sie niemals sichtbar.",
  nor: "Das Winkelmass ist ein kleines, lichtschwaches Sternbild in der Milchstrasse zwischen Wolf und Skorpion, sein hellster Stern erreicht nur Groessenklasse 4,0. Lacaille fuehrte es im 18. Jahrhundert als Zeichengeraet der Baumeister ein. Von Deutschland aus bleibt es stets unter dem Horizont.",
  oct: "Der Oktant enthaelt den suedlichen Himmelspol, um den sich fuer Beobachter der Suedhalbkugel der ganze Himmel dreht; einen hellen Polarstern wie im Norden gibt es dort nicht, der Polstern Sigma Octantis ist nur mit Muehe freisichtig. Lacaille benannte das lichtschwache Sternbild im 18. Jahrhundert nach einem Navigationsinstrument. Von Deutschland aus ist es niemals sichtbar.",
  oph: "Der Schlangentraeger ist ein grosses Sternbild zwischen Skorpion und Herkules, sein hellster Stern Rasalhague erreicht Groessenklasse 2,1. Er stellt den Heilkundigen Asklepios dar, der die Schlange haelt, das Sternbild Schlange umschliesst ihn beidseitig. Die Sonne wandert jedes Jahr Anfang Dezember durch den Schlangentraeger, obwohl er nicht zu den zwoelf Tierkreiszeichen zaehlt. Von Deutschland aus steht er an Sommerabenden im Sueden.",
  ori: "Orion ist das Prachtstueck des Winterhimmels: Die drei Guertelsterne in einer Reihe, der rote Ueberriese Beteigeuze an der Schulter und der blauweisse Rigel am Fuss machen den Himmelsjaeger unverwechselbar. Unter dem Guertel haengt der Orionnebel M42, ein Sternentstehungsgebiet, das schon mit blossem Auge als Nebelfleck schimmert. In der griechischen Mythologie ist Orion der grosse Jaeger, den ein Skorpion toetete. Von Deutschland aus steht er an Winterabenden hoch im Sueden.",
  pav: "Der Pfau ist ein Sternbild des tiefen Suedhimmels, sein hellster Stern Peacock erreicht Groessenklasse 1,9. Er wurde Ende des 16. Jahrhunderts nach den Beobachtungen der niederlaendischen Seefahrer Keyser und de Houtman eingefuehrt und nach dem Prachtvogel benannt, der in der griechischen Sage der Hera heilig war. Von Deutschland aus ist er niemals sichtbar.",
  peg: "Pegasus dominiert den Herbsthimmel mit dem grossen Herbstviereck, das sein Rumpf bildet; die hellsten Sterne sind Enif, Scheat und Markab um Groessenklasse 2,4. Die Nordostecke des Vierecks gehoert offiziell bereits zur Andromeda. In der griechischen Mythologie ist Pegasus das gefluegelte Pferd, das aus dem Blut der Medusa entsprang. Von Deutschland aus steht er an Herbstabenden hoch im Sueden.",
  per: "Perseus liegt in der Milchstrasse zwischen Kassiopeia und Fuhrmann, sein hellster Stern Mirfak erreicht Groessenklasse 1,8. Beruehmt ist der Bedeckungsveraenderliche Algol, das Teufelsauge, dessen Helligkeit alle 2,9 Tage fuer Stunden deutlich einbricht, sowie der doppelte Sternhaufen h und Chi Persei. Perseus ist der Held, der Medusa enthauptete und Andromeda rettete; aus seiner Richtung scheinen im August die Perseiden zu kommen. Von Deutschland aus ist er fast zirkumpolar und im Herbst und Winter am besten zu sehen.",
  phe: "Der Phoenix ist das hellste der um 1600 eingefuehrten Suedsternbilder, sein Hauptstern Ankaa erreicht Groessenklasse 2,4. Benannt ist er nach dem mythischen Feuervogel, der verbrennt und aus seiner Asche neu ersteht. Von Deutschland aus bleibt er praktisch vollstaendig unter dem Horizont.",
  pic: "Der Maler, eigentlich die Malerstaffelei, ist ein lichtschwaches Sternbild des Suedhimmels neben dem hellen Canopus, sein hellster Stern erreicht Groessenklasse 3,2. Lacaille fuehrte es im 18. Jahrhundert ein. Bekannt wurde Beta Pictoris durch seine grosse Staubscheibe, in der Planeten entstehen. Von Deutschland aus ist der Maler niemals sichtbar.",
  psc: "Die Fische sind ein grosses, aber sehr lichtschwaches Tierkreissternbild, das das Herbstviereck des Pegasus von Osten und Sueden umrahmt; erkennbar ist am ehesten der kleine Ring des westlichen Fisches. In ihnen liegt der Fruehlingspunkt, den die Sonne zu Fruehlingsbeginn passiert. Nach der griechischen Sage sind es Aphrodite und Eros, die sich als Fische vor dem Ungeheuer Typhon retteten. Von Deutschland aus stehen sie an Herbstabenden hoch im Sueden, brauchen aber dunklen Himmel.",
  psa: "Der Suedliche Fisch ist ein kleines Sternbild tief am Herbsthimmel, dessen heller Hauptstern Fomalhaut mit Groessenklasse 1,2 einsam ueber dem Suedhorizont funkelt, waehrend die uebrigen Sterne unscheinbar bleiben. Fomalhaut bedeutet Maul des Fisches, der Fisch trinkt in alten Darstellungen das Wasser des Wassermanns. Um Fomalhaut wurde eine grosse Staubscheibe nachgewiesen. Von Deutschland aus ist er an Herbstabenden nur knapp ueber dem Suedhorizont zu sehen.",
  pup: "Das Achterdeck des Schiffs ist der noerdlichste Teil des zerlegten antiken Riesensternbilds Schiff Argo und liegt in einer sternreichen Milchstrassenregion oestlich des Grossen Hundes, sein hellster Stern Naos erreicht Groessenklasse 2,2. Es enthaelt mehrere schoene offene Sternhaufen wie M46 und M47. Von Deutschland aus ist nur der Nordteil an Winterabenden tief ueber dem Suedhorizont zu sehen.",
  pyx: "Der Schiffskompass ist ein kleines, lichtschwaches Sternbild am Rand der Milchstrasse suedlich der Wasserschlange, sein hellster Stern erreicht Groessenklasse 3,7. Lacaille fuehrte ihn im 18. Jahrhundert ein, thematisch passend zum benachbarten zerlegten Schiff Argo. Von Deutschland aus ist er an spaeten Winterabenden nur tief ueber dem Suedhorizont auszumachen.",
  ret: "Das Netz ist ein kleines Sternbild des tiefen Suedhimmels nahe der Grossen Magellanschen Wolke, sein hellster Stern erreicht Groessenklasse 3,3. Lacaille benannte es im 18. Jahrhundert nach dem Fadennetz im Okular seines Messfernrohrs. Von Deutschland aus ist es niemals sichtbar.",
  sge: "Der Pfeil ist das drittkleinste Sternbild, seine vier Hauptsterne um Groessenklasse 3,5 bis 4,4 bilden mitten im Sommerdreieck eine kleine, aber deutliche Pfeilform. Schon die Antike sah hier ein Geschoss, gedeutet etwa als Pfeil des Herakles oder Amors. Von Deutschland aus steht er an Sommerabenden hoch am Himmel und ist bei dunklem Himmel leicht zu finden.",
  sgr: "Der Schuetze ist ein Tierkreissternbild, dessen helle Sterne die markante Form einer Teekanne bilden; in seiner Richtung liegt das Zentrum unserer Milchstrasse in rund 27000 Lichtjahren Entfernung. Bei dunklem Himmel zeigen sich hier die dichtesten Sternwolken und Nebel wie der Lagunennebel M8. Dargestellt ist ein pfeilschiessender Kentaur der griechischen Mythologie. Von Deutschland aus steht er an Sommerabenden tief ueber dem Suedhorizont.",
  sco: "Der Skorpion ist eines der eindrucksvollsten Tierkreissternbilder: Vom roten Ueberriesen Antares, dem Gegenmars mit Groessenklasse 1,0, schwingt sich eine helle Sternenkette zum Giftstachel. In der griechischen Mythologie ist es der Skorpion, der den Jaeger Orion toetete, weshalb beide nie gemeinsam am Himmel stehen. Von Deutschland aus ist an Sommerabenden nur der obere Teil mit Antares tief im Sueden zu sehen, der Stachel bleibt unter dem Horizont.",
  scl: "Der Bildhauer ist ein sehr lichtschwaches Sternbild suedlich des Walfischs, dessen hellste Sterne kaum die vierte Groessenklasse ueberschreiten. Lacaille fuehrte es im 18. Jahrhundert als Bildhauerwerkstatt ein; in ihm liegen der Galaktische Suedpol und die helle Spiralgalaxie NGC 253. Von Deutschland aus ist es an Herbstabenden nur tief ueber dem Suedhorizont zu erahnen.",
  sct: "Das Schild ist das fuenftkleinste Sternbild und liegt in einer hellen Sternwolke der Milchstrasse zwischen Adler und Schuetze, seine Sterne bleiben unter Groessenklasse 3,8. Hevelius fuehrte es 1684 als Schild des Polenkoenigs Johann III. Sobieski ein, es ist damit das einzige Sternbild mit Bezug auf eine historische Person. Sehenswert ist der offene Sternhaufen M11, der Wildentenhaufen. Von Deutschland aus steht es an Sommerabenden im Sueden.",
  ser: "Die Schlange ist das einzige Sternbild, das aus zwei getrennten Teilen besteht: Schlangenkopf westlich und Schlangenschwanz oestlich des Schlangentraegers, der sie haelt. Ihr hellster Stern Unukalhai im Kopfteil erreicht Groessenklasse 2,6, im Schwanzteil liegt der Adlernebel M16 mit seinen beruehmten Gassaeulen. In der Mythologie gehoert die Schlange zum Heilgott Asklepios, daher stammt das Schlangensymbol der Medizin. Von Deutschland aus steht sie an Sommerabenden im Sueden.",
  sex: "Der Sextant ist ein sehr unauffaelliges Sternbild am Himmelsaequator suedlich des Regulus im Loewen, sein hellster Stern erreicht nur Groessenklasse 4,5. Hevelius fuehrte ihn im 17. Jahrhundert zur Erinnerung an sein bei einem Brand zerstoertes Messinstrument ein. Von Deutschland aus ist er an Fruehlingsabenden nur bei dunklem Himmel im Sueden auszumachen.",
  tau: "Der Stier ist ein praechtiges Tierkreissternbild des Winterhimmels: Das V der Hyaden mit dem roten Riesen Aldebaran, dem Stierauge von Groessenklasse 0,9, bildet den Kopf, die Plejaden auf dem Ruecken sind der schoenste mit blossem Auge sichtbare Sternhaufen. Im Stier steht auch der Krebsnebel M1, Ueberrest der Supernova von 1054. Nach der griechischen Sage ist es der Stier, als der Zeus die Europa entfuehrte. Von Deutschland aus steht er an Winterabenden hoch im Sueden.",
  tel: "Das Fernrohr ist ein lichtschwaches Sternbild des Suedhimmels direkt unterhalb von Schuetze und Suedlicher Krone, sein hellster Stern erreicht nur Groessenklasse 3,5. Lacaille fuehrte es im 18. Jahrhundert zu Ehren der grossen Teleskope seiner Zeit ein. Von Deutschland aus bleibt es stets unter dem Horizont.",
  tri: "Das Dreieck ist ein kleines, aber trotz seiner schwachen Sterne gut erkennbares Sternbild zwischen Andromeda und Widder, seine drei Hauptsterne erreichen Groessenklasse 3,0 bis 4,0. Schon die Griechen kannten es als Deltoton nach dem Buchstaben Delta. In ihm liegt die Dreiecksgalaxie M33, ein Mitglied der Lokalen Gruppe, die unter perfektem Himmel gerade noch mit blossem Auge erkennbar ist. Von Deutschland aus steht es an Herbstabenden hoch am Himmel.",
  tra: "Das Suedliche Dreieck ist ein kompaktes Sternbild des tiefen Suedhimmels nahe Alpha Centauri, seine drei Hauptsterne von Groessenklasse 1,9 bis 2,9 bilden ein fast gleichseitiges Dreieck, das deutlicher hervortritt als das noerdliche Gegenstueck. Eingefuehrt wurde es Ende des 16. Jahrhunderts nach den Fahrten niederlaendischer Seefahrer. Von Deutschland aus ist es niemals sichtbar.",
  tuc: "Der Tukan ist ein Sternbild des tiefen Suedhimmels, sein hellster Stern erreicht Groessenklasse 2,9. In ihm liegen die Kleine Magellansche Wolke und der prachtvolle Kugelsternhaufen 47 Tucanae, der zweithellste des Himmels. Benannt wurde das um 1600 eingefuehrte Sternbild nach dem grossschnaebeligen Vogel Suedamerikas. Von Deutschland aus ist der Tukan niemals sichtbar.",
  uma: "Der Grosse Baer enthaelt den Grossen Wagen, die wohl bekannteste Sternfigur des Nordhimmels aus sieben hellen Sternen um Groessenklasse 2. Die Verlaengerung seiner hinteren Kastensterne fuehrt zum Polarstern, im Deichselknick steht das beruehmte Augenpruefer-Paar Mizar und Alkor. Nach der griechischen Sage ist es die in eine Baerin verwandelte Nymphe Kallisto. Von Deutschland aus ist der Grosse Baer zirkumpolar und in jeder klaren Nacht sichtbar.",
  umi: "Der Kleine Baer, auch Kleiner Wagen genannt, traegt an seiner Deichselspitze den Polarstern, der mit Groessenklasse 2,0 fast genau am noerdlichen Himmelspol steht und seit Jahrhunderten zur Orientierung dient. Seine uebrigen Sterne sind deutlich schwaecher, die beiden Kastensterne Kochab und Pherkad heissen Waechter des Pols. Nach der Sage ist es Arkas, der Sohn der Kallisto. Von Deutschland aus ist er zirkumpolar und die ganze Nacht zu sehen.",
  vel: "Das Segel des Schiffs ist ein helles Sternbild der suedlichen Milchstrasse und Teil des zerlegten antiken Riesensternbilds Schiff Argo, seine hellsten Sterne erreichen etwa Groessenklasse 1,8. In ihm leuchten der heisseste mit blossem Auge sichtbare Stern Gamma Velorum und der ausgedehnte Vela-Supernovaueberrest. Von Deutschland aus bleibt das Segel praktisch vollstaendig unter dem Horizont.",
  vir: "Die Jungfrau ist nach der Wasserschlange das zweitgroesste Sternbild, ihr hellster Stern Spica erreicht Groessenklasse 1,0 und ist ueber den Deichselbogen des Grossen Wagens hinter Arktur leicht zu finden. In ihr liegt der grosse Virgo-Galaxienhaufen mit tausenden Sternsystemen. Gedeutet wird die Figur meist als Erntegoettin mit Kornaehre, denn nichts anderes bedeutet Spica. Von Deutschland aus steht sie an Fruehlingsabenden im Sueden.",
  vol: "Der Fliegende Fisch ist ein kleines, lichtschwaches Sternbild des tiefen Suedhimmels zwischen dem Kiel des Schiffs und der Grossen Magellanschen Wolke, seine hellsten Sterne erreichen nur knapp Groessenklasse 3,8. Benannt wurde das um 1600 nach den Fahrten niederlaendischer Seefahrer eingefuehrte Sternbild nach den tropischen Fischen, die ueber das Wasser gleiten. Von Deutschland aus ist es niemals sichtbar.",
  vul: "Der Fuchs ist ein lichtschwaches Sternbild mitten im Sommerdreieck zwischen Schwan und Pfeil, sein hellster Stern erreicht nur Groessenklasse 4,4. Hevelius fuehrte ihn im 17. Jahrhundert als Fuchs mit Gans ein. In ihm liegt der Hantelnebel M27, einer der schoensten planetarischen Nebel, ausserdem wurde hier 1967 der erste Pulsar entdeckt. Von Deutschland aus steht er an Sommerabenden hoch am Himmel, ist aber nur bei dunklem Himmel zu erkennen.",
};

// ---------------------------------------------------------------------------
// Infotexte fuer Nicht-Sterne (data/objects.json)
// ---------------------------------------------------------------------------

const OBJECTS = {
  sonne: {
    name: "Sonne",
    typ: "Stern",
    info: "Die Sonne ist ein Stern der Spektralklasse G2 und das Zentrum unseres Planetensystems. Ihr Durchmesser von rund 1,39 Millionen Kilometern entspricht etwa 109 Erddurchmessern, ihr Licht braucht fuer die knapp 150 Millionen Kilometer bis zur Erde gut acht Minuten. Im Kern verschmilzt sie in jeder Sekunde rund 600 Millionen Tonnen Wasserstoff zu Helium und erzeugt so ihre Energie. Niemals ungeschuetzt in die Sonne blicken. Mit einer zertifizierten Sonnenfinsternisbrille lassen sich mit blossem Auge bei ruhiger Luft sogar grosse Sonnenflecken erkennen.",
  },
  mond: {
    name: "Mond",
    typ: "Mond",
    info: "Der Mond ist der einzige natuerliche Begleiter der Erde und umkreist sie in durchschnittlich 384400 Kilometern Abstand. Sein Durchmesser von 3476 Kilometern entspricht etwas mehr als einem Viertel des Erddurchmessers. Die Phasen von Neumond bis Vollmond entstehen, weil die beleuchtete Haelfte je nach Stellung zur Sonne aus wechselnder Richtung zu sehen ist. Mit blossem Auge sind die dunklen Mare gut zu erkennen, ausgedehnte Ebenen aus erstarrter Lava. Besonders plastisch wirkt der Mond in den Naechten um Halbmond, wenn an der Licht-Schatten-Grenze lange Schatten Krater und Gebirge betonen.",
  },
  merkur: {
    name: "Merkur",
    typ: "Planet",
    info: "Merkur ist mit 4879 Kilometern Durchmesser der kleinste Planet und zieht als innerster in durchschnittlich 58 Millionen Kilometern Abstand um die Sonne. Er besitzt praktisch keine Atmosphaere, weshalb die Temperaturen an der Oberflaeche zwischen etwa minus 170 und plus 430 Grad Celsius schwanken. Am Himmel entfernt er sich nie weit von der Sonne und steht deshalb immer tief in der Daemmerung. Mit blossem Auge gelingt die Sichtung von Deutschland aus am ehesten waehrend einer Abendsichtbarkeit im Fruehjahr tief ueber dem Westhorizont oder waehrend einer Morgensichtbarkeit im Herbst ueber dem Osthorizont.",
  },
  venus: {
    name: "Venus",
    typ: "Planet",
    info: "Die Venus ist mit 12104 Kilometern Durchmesser fast so gross wie die Erde und kommt ihr naeher als jeder andere Planet. Ihre dichte Kohlendioxidatmosphaere erzeugt einen extremen Treibhauseffekt mit Oberflaechentemperaturen um 460 Grad Celsius. Nach Sonne und Mond ist sie das hellste Gestirn am Himmel und erreicht bis zu Magnitude minus 4,8. Mit blossem Auge zeigt sie sich als strahlend weisser Abendstern ueber dem Westhorizont oder als Morgenstern im Osten, stets in Sonnennaehe und schon in der Daemmerung unuebersehbar.",
  },
  mars: {
    name: "Mars",
    typ: "Planet",
    info: "Mars ist der aeussere Nachbar der Erde, sein Durchmesser von 6779 Kilometern entspricht etwa der Haelfte des irdischen. Eisenoxidstaub faerbt seine Wuestenlandschaften rot, dazu kommen Polkappen aus Eis, der Riesenvulkan Olympus Mons und das gewaltige Grabensystem Valles Marineris. Die Entfernung zur Erde schwankt stark zwischen rund 56 und 400 Millionen Kilometern. Etwa alle 26 Monate steht Mars in Opposition, dann ist er die ganze Nacht sichtbar und mit blossem Auge sofort an seinem auffaellig roetlichen Licht zu erkennen.",
  },
  jupiter: {
    name: "Jupiter",
    typ: "Planet",
    info: "Jupiter ist mit rund 143000 Kilometern Aequatordurchmesser der groesste Planet des Sonnensystems, ein Gasriese aus Wasserstoff und Helium. Zu seinen Besonderheiten zaehlen der Grosse Rote Fleck, ein seit Jahrhunderten aktiver Wirbelsturm, und seine vier grossen Monde Io, Europa, Ganymed und Kallisto. Die Sonne umrundet er in durchschnittlich 778 Millionen Kilometern Abstand einmal in knapp zwoelf Jahren. Mit blossem Auge erscheint Jupiter ueber viele Monate als sehr heller, ruhig leuchtender weisslicher Punkt, der jeden Stern des Nachthimmels ueberstrahlt.",
  },
  saturn: {
    name: "Saturn",
    typ: "Planet",
    info: "Saturn ist mit etwa 120500 Kilometern Durchmesser der zweitgroesste Planet und beruehmt fuer sein ausgedehntes Ringsystem aus unzaehligen Eis- und Gesteinsbrocken. Er umrundet die Sonne in rund 1,4 Milliarden Kilometern Abstand einmal in 29,5 Jahren und besitzt mehr als 140 Monde, darunter den grossen Titan mit dichter Atmosphaere. Seine mittlere Dichte ist geringer als die von Wasser. Mit blossem Auge zeigt sich Saturn als gelblicher, ruhig leuchtender Punkt von etwa nullter Groessenklasse, die Ringe selbst werden erst im Teleskop sichtbar.",
  },
  uranus: {
    name: "Uranus",
    typ: "Planet",
    info: "Uranus ist ein Eisriese mit 50724 Kilometern Durchmesser und umrundet die Sonne in rund 2,9 Milliarden Kilometern Abstand einmal in 84 Jahren. Seine Rotationsachse ist um etwa 98 Grad gekippt, er rollt also gewissermassen auf seiner Bahn um die Sonne. Methan in der Atmosphaere verleiht ihm eine blaugruene Faerbung. Mit einer Helligkeit um Magnitude 5,7 ist Uranus in klaren, mondlosen Landnaechten gerade noch mit blossem Auge erkennbar, dafuer muss die Position aber sehr genau bekannt sein.",
  },
  neptun: {
    name: "Neptun",
    typ: "Planet",
    info: "Neptun ist der aeusserste Planet des Sonnensystems, ein Eisriese mit 49244 Kilometern Durchmesser in durchschnittlich 4,5 Milliarden Kilometern Sonnenabstand, ein Umlauf dauert fast 165 Jahre. In seiner methanhaltigen, tiefblauen Atmosphaere wehen die schnellsten Winde des Sonnensystems mit bis zu 2000 Kilometern pro Stunde. Sein groesster Mond Triton umkreist ihn entgegen dessen Rotationsrichtung. Fuer das blosse Auge bleibt Neptun mit Magnitude 7,8 unsichtbar, schon ein Fernglas zeigt ihn aber als schwaches blaeuliches Puenktchen, wenn die Position bekannt ist.",
  },
};

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

const GREEK = {
  Alp: "α", Bet: "β", Gam: "γ", Del: "δ", Eps: "ε", Zet: "ζ", Eta: "η",
  The: "θ", Iot: "ι", Kap: "κ", Lam: "λ", Mu: "μ", Nu: "ν", Xi: "ξ",
  Omi: "ο", Pi: "π", Rho: "ρ", Sig: "σ", Tau: "τ", Ups: "υ", Phi: "φ",
  Chi: "χ", Psi: "ψ", Ome: "ω",
};
const SUPERSCRIPT = { 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };

function round(x, digits) {
  return Number(x.toFixed(digits));
}

function download(url, dest) {
  // curl nutzt automatisch den vorkonfigurierten Proxy (HTTPS_PROXY) samt CA-Bundle.
  execFileSync("curl", ["-sS", "--fail", "--location", "--max-time", "300", "-o", dest, url], {
    stdio: ["ignore", "inherit", "inherit"],
  });
}

/** Eine CSV-Zeile in Felder zerlegen (Anfuehrungszeichen-sicher, keine mehrzeiligen Felder in HYG). */
function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
      } else cur += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      out.push(cur); cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

/** Bayer-Bezeichnung huebsch formatieren: "Alp-2" + "UMa" -> "α² UMa". */
function formatBayer(bayerRaw, iau) {
  if (!bayerRaw) return "";
  const m = /^([A-Za-z]+)(?:-(\d))?$/.exec(bayerRaw.trim());
  if (!m) return "";
  const greek = GREEK[m[1]];
  if (!greek) return "";
  const sup = m[2] ? SUPERSCRIPT[m[2]] || m[2] : "";
  return `${greek}${sup} ${iau}`;
}

/** Spektralklasse kuerzen: erstes Token, max. 10 Zeichen. */
function shortSpect(spect) {
  return String(spect || "").trim().split(/[\s/]/)[0].slice(0, 10);
}

/**
 * Kantenpaare zu Polylinien zusammenfassen.
 * Ketten beginnen bevorzugt an Endpunkten mit Restgrad 1; Zyklen werden als
 * geschlossene Polylinie ausgegeben. Doppelte Kanten werden entfernt.
 */
function pairsToPolylines(pairs) {
  const edges = [];
  const seen = new Set();
  for (const [a, b] of pairs) {
    if (a === b) continue;
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push([a, b]);
  }
  const adj = new Map();
  edges.forEach(([a, b], i) => {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(i);
    adj.get(b).push(i);
  });
  const used = new Array(edges.length).fill(false);
  const restDegree = (node) => adj.get(node).reduce((n, i) => n + (used[i] ? 0 : 1), 0);
  const takeEdgeAt = (node) => {
    const i = (adj.get(node) || []).find((k) => !used[k]);
    if (i === undefined) return null;
    used[i] = true;
    const [a, b] = edges[i];
    return a === node ? b : a;
  };
  const polylines = [];
  // Zwei Durchgaenge: erst echte Kettenenden (Grad 1), dann Rest (Zyklen).
  for (const pass of [1, 2]) {
    for (let s = 0; s < edges.length; s++) {
      if (used[s]) continue;
      const [a, b] = edges[s];
      let start;
      if (pass === 1) {
        if (restDegree(a) === 1) start = a;
        else if (restDegree(b) === 1) start = b;
        else continue;
      } else {
        start = a;
      }
      const line = [start];
      let cur = start;
      for (;;) {
        const next = takeEdgeAt(cur);
        if (next === null) break;
        line.push(next);
        cur = next;
      }
      if (line.length >= 2) polylines.push(line);
    }
  }
  return polylines;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function build({ offline }) {
  mkdirSync(CACHE_DIR, { recursive: true });
  mkdirSync(DATA_DIR, { recursive: true });

  if (!offline) {
    if (!existsSync(HYG_FILE) || statSync(HYG_FILE).size < 1000000) {
      console.log(`Lade ${HYG_URL}`);
      download(HYG_URL, HYG_FILE);
    }
    if (!existsSync(FAB_FILE) || statSync(FAB_FILE).size < 1000) {
      console.log(`Lade ${FAB_URL}`);
      download(FAB_URL, FAB_FILE);
    }
  }

  // --- HYG-Katalog einlesen -------------------------------------------------
  const csv = gunzipSync(readFileSync(HYG_FILE)).toString("utf8");
  const lines = csv.split(/\r?\n/).filter((l) => l.length > 0);
  const header = parseCsvLine(lines[0]).map((h) => h.replace(/"/g, ""));
  const col = Object.fromEntries(header.map((h, i) => [h, i]));
  for (const need of ["id", "hip", "proper", "ra", "dec", "dist", "mag", "spect", "ci", "bayer", "con"]) {
    if (!(need in col)) throw new Error(`HYG-Spalte fehlt: ${need}`);
  }

  /** @type {Map<number, object>} hellster Eintrag je HIP */
  const byHip = new Map();
  /** Alle Katalogzeilen mit mag <= MAG_LIMIT (ohne Sonne) */
  const brightRows = [];

  for (let i = 1; i < lines.length; i++) {
    const f = parseCsvLine(lines[i]);
    const id = Number(f[col.id]);
    if (id === 0) continue; // Sonne ("Sol") ueberspringen
    const raH = Number(f[col.ra]);
    const dec = Number(f[col.dec]);
    const mag = Number(f[col.mag]);
    if (!Number.isFinite(raH) || !Number.isFinite(dec) || !Number.isFinite(mag)) continue;
    const hip = f[col.hip] ? Number(f[col.hip]) : 0;
    const row = {
      hip,
      raDeg: raH * 15,
      decDeg: dec,
      mag,
      bv: f[col.ci] ? Number(f[col.ci]) : 0,
      proper: (f[col.proper] || "").trim(),
      bayer: (f[col.bayer] || "").trim(),
      con: (f[col.con] || "").trim(),
      dist: Number(f[col.dist]),
      spect: shortSpect(f[col.spect]),
    };
    if (hip > 0) {
      const prev = byHip.get(hip);
      if (!prev || row.mag < prev.mag) byHip.set(hip, row);
    }
    if (mag <= MAG_LIMIT) brightRows.push(row);
  }

  // --- Sternbildlinien einlesen --------------------------------------------
  const fab = readFileSync(FAB_FILE, "utf8");
  /** @type {Map<string, number[][]>} con-Kuerzel (klein) -> HIP-Paare */
  const conPairs = new Map();
  for (const line of fab.split(/\r?\n/)) {
    const t = line.trim().split(/\s+/).filter(Boolean);
    if (t.length < 4 || t[0].startsWith("#")) continue;
    const code = t[0].toLowerCase();
    const n = Number(t[1]);
    const nums = t.slice(2).map(Number);
    if (nums.length !== 2 * n) throw new Error(`fab-Zeile inkonsistent: ${t[0]} erwartet ${2 * n} HIPs, hat ${nums.length}`);
    const pairs = [];
    for (let i = 0; i < nums.length; i += 2) pairs.push([nums[i], nums[i + 1]]);
    conPairs.set(code, pairs);
  }

  // --- Sternliste zusammenstellen ------------------------------------------
  // 1) alle Sterne mag <= 6.0 (je HIP nur der hellste Eintrag, HIP-lose einzeln)
  // 2) plus alle in Linien referenzierten HIPs, auch wenn schwaecher
  const lineHips = new Set();
  for (const pairs of conPairs.values()) for (const [a, b] of pairs) { lineHips.add(a); lineHips.add(b); }

  const chosen = new Map(); // hip -> row (hip > 0)
  const noHip = [];
  for (const row of brightRows) {
    if (row.hip > 0) {
      const best = byHip.get(row.hip);
      if (!chosen.has(row.hip)) chosen.set(row.hip, best || row);
    } else {
      noHip.push(row);
    }
  }
  const missingLineHips = [];
  for (const hip of lineHips) {
    if (chosen.has(hip)) continue;
    const row = byHip.get(hip);
    if (row) chosen.set(hip, row);
    else missingLineHips.push(hip);
  }
  if (missingLineHips.length) {
    console.warn(`Warnung: ${missingLineHips.length} Linien-HIPs nicht im HYG-Katalog: ${missingLineHips.join(", ")}`);
  }

  const allRows = [...chosen.values(), ...noHip].sort((a, b) => a.mag - b.mag);
  const starsArr = allRows.map((r) => [
    round(((r.raDeg % 360) + 360) % 360, 4),
    round(r.decDeg, 4),
    round(r.mag, 2),
    round(r.bv, 2),
    r.hip,
    r.proper,
    formatBayer(r.bayer, CONSTELLATIONS[r.con.toLowerCase()]?.iau || r.con),
    r.con.toLowerCase(),
    r.dist > 0 && r.dist < HYG_DIST_UNKNOWN ? Math.round(r.dist * PC_TO_LJ) : 0,
    r.spect,
  ]);

  const starsJson = {
    meta: {
      source: "HYG v3.8 (astronexus/HYG-Database, CC BY-SA 2.5) + Stellarium modern skyculture v24.4 (Linienreferenzen)",
      count: starsArr.length,
      magLimit: MAG_LIMIT,
    },
    stars: starsArr,
  };

  // --- Sternbilder ----------------------------------------------------------
  const starHips = new Set(starsArr.map((s) => s[4]).filter((h) => h > 0));
  const constellationsJson = {};
  for (const [code, meta] of Object.entries(CONSTELLATIONS)) {
    const pairs = (conPairs.get(code) || []).filter(([a, b]) => {
      const ok = starHips.has(a) && starHips.has(b);
      if (!ok) console.warn(`Warnung: Linie ${a}-${b} in ${code} verworfen (HIP fehlt im Katalog)`);
      return ok;
    });
    // Solange kein redaktioneller Infotext vorliegt, sachlicher 1-Satz-Platzhalter.
    const info = INFO[code] ||
      `${meta.de} (lateinisch ${meta.lat}) ist eines der 88 von der IAU anerkannten Sternbilder.`;
    constellationsJson[code] = {
      lat: meta.lat,
      de: meta.de,
      lines: pairsToPolylines(pairs),
      info,
    };
  }
  const fabOnly = [...conPairs.keys()].filter((c) => !CONSTELLATIONS[c]);
  if (fabOnly.length) throw new Error(`Unbekannte Kuerzel in constellationship.fab: ${fabOnly.join(", ")}`);

  // --- Schreiben ------------------------------------------------------------
  // stars.json: eine Zeile pro Stern (kompakt und trotzdem diff-freundlich)
  const starsText =
    '{"meta":' + JSON.stringify(starsJson.meta) + ',\n"stars":[\n' +
    starsArr.map((s) => JSON.stringify(s)).join(",\n") +
    "\n]}\n";
  writeFileSync(path.join(DATA_DIR, "stars.json"), starsText);
  writeFileSync(path.join(DATA_DIR, "constellations.json"), JSON.stringify(constellationsJson, null, 1) + "\n");
  writeFileSync(path.join(DATA_DIR, "objects.json"), JSON.stringify(OBJECTS, null, 1) + "\n");

  console.log(`stars.json:          ${starsArr.length} Sterne (mag <= ${MAG_LIMIT} plus ${[...lineHips].length} Linien-HIPs)`);
  console.log(`constellations.json: ${Object.keys(constellationsJson).length} Sternbilder`);
  console.log(`objects.json:        ${Object.keys(OBJECTS).length} Objekte`);
}

// ---------------------------------------------------------------------------
// Validierung (Abnahmebedingungen aus dem Auftrag)
// ---------------------------------------------------------------------------

function validate() {
  const problems = [];
  const ok = (cond, msg) => {
    if (cond) console.log(`  OK   ${msg}`);
    else { problems.push(msg); console.error(`  FAIL ${msg}`); }
  };

  const stars = JSON.parse(readFileSync(path.join(DATA_DIR, "stars.json"), "utf8"));
  const cons = JSON.parse(readFileSync(path.join(DATA_DIR, "constellations.json"), "utf8"));
  const objs = JSON.parse(readFileSync(path.join(DATA_DIR, "objects.json"), "utf8"));
  console.log("Alle drei JSON-Dateien geparst.");

  ok(stars.stars.length >= 4500 && stars.stars.length <= 9000, `stars.json: ${stars.stars.length} Sterne (Soll 4500..9000)`);
  ok(stars.meta && stars.meta.count === stars.stars.length && stars.meta.magLimit === 6.0, "stars.json: meta.count und meta.magLimit konsistent");

  const rowShapeOk = stars.stars.every(
    (s) => Array.isArray(s) && s.length === 10 &&
      typeof s[0] === "number" && s[0] >= 0 && s[0] < 360 &&
      typeof s[1] === "number" && s[1] >= -90 && s[1] <= 90 &&
      typeof s[2] === "number" && typeof s[3] === "number" &&
      Number.isInteger(s[4]) && typeof s[5] === "string" && typeof s[6] === "string" &&
      typeof s[7] === "string" && Number.isInteger(s[8]) && typeof s[9] === "string"
  );
  ok(rowShapeOk, "stars.json: alle Zeilen im Contract-Format [raDeg,decDeg,mag,bv,hip,name,bayer,con,distLj,spect]");

  const hipSet = new Set(stars.stars.map((s) => s[4]).filter((h) => h > 0));
  const codes = Object.keys(cons);
  ok(codes.length === 88, `constellations.json: ${codes.length} Sternbilder (Soll 88)`);

  let missingHip = 0, lineCount = 0, infoBad = [];
  const dashRe = /[–—]/;
  const emojiRe = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;
  for (const [code, c] of Object.entries(cons)) {
    for (const line of c.lines) {
      lineCount++;
      for (const hip of line) if (!hipSet.has(hip)) { missingHip++; console.error(`    fehlende HIP ${hip} in ${code}`); }
    }
    if (typeof c.lat !== "string" || !c.lat || typeof c.de !== "string" || !c.de) infoBad.push(`${code}: lat/de fehlt`);
    if (typeof c.info !== "string" || c.info.length < 120 || c.info.length > 700) infoBad.push(`${code}: info-Laenge ${c.info?.length}`);
    else if (dashRe.test(c.info) || emojiRe.test(c.info)) infoBad.push(`${code}: Gedankenstrich oder Emoji im Infotext`);
  }
  ok(missingHip === 0, `constellations.json: alle Linien-HIPs vorhanden (${lineCount} Polylinien geprueft)`);
  ok(infoBad.length === 0, `constellations.json: lat/de/info vollstaendig und stilkonform${infoBad.length ? " [" + infoBad.join("; ") + "]" : ""}`);

  const wanted = ["sonne", "mond", "merkur", "venus", "mars", "jupiter", "saturn", "uranus", "neptun"];
  ok(wanted.every((k) => objs[k] && objs[k].name && objs[k].typ && typeof objs[k].info === "string" && objs[k].info.length >= 150),
    "objects.json: alle 9 Schluessel mit name/typ/info");
  ok(wanted.every((k) => !dashRe.test(objs[k]?.info || "") && !emojiRe.test(objs[k]?.info || "")),
    "objects.json: keine Gedankenstriche/Emojis");

  const polaris = stars.stars.find((s) => s[4] === 11767);
  ok(!!polaris && Math.abs(polaris[0] - 37.95) < 0.3 && Math.abs(polaris[1] - 89.26) < 0.1,
    `Stichprobe Polarstern HIP 11767: RA ${polaris?.[0]}, Dec ${polaris?.[1]} (Soll ~37.95/+89.26)`);
  const sirius = stars.stars.find((s) => s[4] === 32349);
  ok(!!sirius && Math.abs(sirius[2] - -1.44) < 0.07,
    `Stichprobe Sirius HIP 32349: mag ${sirius?.[2]} (Soll ~-1.44)`);

  if (problems.length) {
    console.error(`\nValidierung FEHLGESCHLAGEN: ${problems.length} Problem(e).`);
    process.exitCode = 1;
  } else {
    console.log("\nValidierung erfolgreich.");
  }
}

// ---------------------------------------------------------------------------

const args = new Set(process.argv.slice(2));
if (args.has("--validate")) {
  validate();
} else {
  build({ offline: args.has("--offline") });
  console.log("");
  validate();
}
