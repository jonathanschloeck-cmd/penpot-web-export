# Web Export – Penpot-Plugin

Macht aus Penpot-Boards eine fertige Website: `index.html`, weitere Seiten, `style.css` und Bilder, alles in einer ZIP-Datei.

## Installieren

In Penpot **Strg + Alt + P** drücken, diese Adresse einfügen und auf **Installieren** klicken:

```
https://jonathanschloeck-cmd.github.io/penpot-web-export/manifest.json
```

## Lokal entwickeln (ohne GitHub)

1. Doppelklick auf **`start-server.cmd`**. Ein Fenster öffnet sich und zeigt die Adresse an. Lass es offen.
2. Penpot öffnen (z. B. design.penpot.app) und eine Datei öffnen.
3. **Strg + Alt + P** drücken, dann `http://localhost:4400/manifest.json` einfügen und auf **Installieren** klicken.
4. Danach startest du das Plugin über den Plugin-Manager (Strg + Alt + P).

Das Server-Fenster muss nur laufen, solange du das Plugin benutzt.

## Benutzen

1. Pro Seite der Website ein **Board** anlegen. Die anderen Seiten heißen wie ihr Board (z. B. „Kontakt“ → `kontakt.html`).
2. Im Board **Flex- oder Grid-Layout** benutzen (Strg + A bzw. Shift + A). Nur dann passt sich die Seite an Handys an.
3. Links im **Prototyp-Modus** verbinden (siehe unten).
4. Plugin öffnen und auf **Website exportieren** klicken. Die `website.zip` wird heruntergeladen.
5. Für den Export einzelner Boards markierst du vorher genau diese.

Welche Seite zur `index.html` wird: das Start-Board des ersten Prototyp-Flows, sonst ein Board namens „Home“ oder „Start“, sonst das Board ganz links.

## Links über den Prototyp-Modus

Oben rechts auf **Prototyp** umschalten, ein Element auswählen und den Pfeil auf ein anderes Board ziehen. Im Export wird daraus ein Link.

| Interaktion in Penpot | Ergebnis auf der Website |
|---|---|
| Bei Klick → **Navigieren zu** Board | Link auf die Seite dieses Boards |
| Bei Klick → **URL öffnen** | Externer Link (öffnet einen neuen Tab) |
| Bei Klick → **Vorheriger Bildschirm** | Zurück-Link |
| Overlays, Hover, Verzögerung | werden ignoriert |

Tipps:
- Lege die Interaktion auf die **Gruppe bzw. das Board des Buttons**, nicht nur auf das Rechteck dahinter. Sonst ist der Text auf dem Button nicht klickbar.
- Texte werden zu normalen Links, Rechtecke, Gruppen und Boards zu Buttons mit Hover-Effekt.
- Führt ein Pfeil zu einem Board, das nicht mit exportiert wird, zeigt das Plugin eine Warnung.

## Ebenen-Namen

Links gehen alternativ auch über den Namen der Ebene. Ein Name hat Vorrang vor dem Prototyp.

| Name der Ebene | Ergebnis |
|---|---|
| `button:/kontakt` | Button, der zur Seite „Kontakt“ führt |
| `button:#preise` | Button, der zum Abschnitt „preise“ springt |
| `link:https://instagram.com/...` | Link (externe Links öffnen einen neuen Tab) |
| `link:hallo@beispiel.de` | E-Mail-Link |
| `section:preise` | Abschnitt mit dem Sprungziel `#preise` |
| `header`, `nav`, `main`, `footer`, `article`, `aside` | passende HTML-Bereiche |
| `h1` … `h6`, `p`, `blockquote` | Überschrift / Absatz (für Textebenen) |
| `img:Beschreibung` | wird als Bild (PNG) exportiert, die Beschreibung wird zum Alt-Text |
| `svg` | wird als Vektorgrafik exportiert |
| `skip` | wird nicht exportiert |

Ohne besonderen Namen gilt: Texte werden zu `<p>`, Boards und Gruppen zu `<div>`. Pfade, Icons und Rechtecke mit Bildfüllung werden automatisch als Bilddatei exportiert.

## Optionen

- **Google Fonts einbinden**: lädt die verwendeten Schriften von Google. Eigene, hochgeladene Schriften musst du selbst einbinden.
- **Für Handys anpassen**: breite Zeilen (Flex-Reihen über 768 px) stehen auf dem Handy untereinander, Grids werden einspaltig, große Innenabstände werden kleiner.
- **Große Schriften mitskalieren**: Schriften über 32 px werden auf kleinen Bildschirmen kleiner.

## Grenzen

- Bilder in der **Füllung eines Boards** werden ignoriert. Leg das Bild stattdessen als eigenes Rechteck ins Board (z. B. mit absoluter Position).
- Boards ohne Flex/Grid ergeben Seiten mit fester Breite.
- Animationen, Formulare und Prototyp-Interaktionen aus Penpot werden nicht übernommen.
