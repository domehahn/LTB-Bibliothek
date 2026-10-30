# LTB Bibliothek

Eine private, responsive Sammlungs- und Kataloganwendung für die **Lustigen Taschenbücher (LTB)**. Die Anwendung läuft als Cloudflare Worker mit D1-Datenbank und bietet einen eigenen Login ohne Zitadel.

Produktivinstanz: <https://ltb-bibliothek.squora.workers.dev>

## Funktionen

- eigener Login mit HttpOnly-Session-Cookie und PBKDF2-SHA-256-Passworthashes
- Katalog der Hauptreihe und zahlreicher Nebenreihen
- Besitzstatus, Wunschliste, Suche, Filter und Paging mit 50, 75 oder 100 Einträgen
- Erstauflage, Nachdruck/Neuauflage, Erscheinungsjahr und exaktes Veröffentlichungsdatum
- Duckipedia-Synchronisierung für Titel, Neuauflage, Erstveröffentlichung und historischen Originalpreis
- Detailansicht zum Erfassen mehrerer Exemplare
- Angaben zu Zustand, Standort, Kaufpreis, Kaufdatum, Notizen und ISBN/EAN
- ISBN-/Barcode-Scanner über die Smartphone-Kamera
- eBay-Marktwert aus aktiven Einzelangeboten mit Durchschnitt, Median und Suchlink
- fortsetzbarer Initialimport der eBay-Werte für alle katalogisierten Ausgaben
- CSV-Export und CSV-Import der persönlichen Sammlung
- mobile Detailansicht ohne verschachteltes Popup-Scrolling
- Service Worker für installierbare Nutzung auf Mobilgeräten

## Technischer Stack

- React, TypeScript und Vite
- Cloudflare Workers
- Cloudflare D1 / SQLite
- Wrangler
- ZXing Browser für ISBN-/Barcode-Erkennung
- Lucide React für Icons

## Lokal starten

Voraussetzungen: Node.js und npm.

```bash
npm install
npm run dev
```

Weitere Prüfungen und Produktionsbuild:

```bash
npm run check
npm run build
```

Für lokale Cloudflare-nahe Entwicklung:

```bash
npm run dev:cloudflare
```

## Cloudflare einrichten

Die Worker-Konfiguration liegt in `wrangler.jsonc`. Die D1-Datenbankbindung heißt `DB`, die statischen Assets werden aus `dist/` geladen.

```bash
npx wrangler login
npx wrangler d1 create ltb-bibliothek
```

Die ausgegebene Datenbank-ID in `wrangler.jsonc` eintragen und anschließend die Migrationen anwenden:

```bash
npx wrangler d1 migrations apply ltb-bibliothek --remote
npm run build
npx wrangler deploy
```

Bei einer neuen Umgebung werden die Migrationen aus `migrations/` in Reihenfolge angewendet. Die aktuellsten Migrationen ergänzen Duckipedia-Neuauflagen und historische Originalpreise.

## Katalogdaten

Die Hauptreihe wird mit der Duckipedia-Ausgabenliste abgeglichen. Über **Katalog aktualisieren** können Titel, Neuauflage, Erstveröffentlichung und Originalpreis erneut importiert werden.

Die Anwendung übernimmt historische Währungen unverändert, zum Beispiel `2,50 DM` oder `8,99 €`. Wenn eine Quelle nur Monat und Jahr nennt, wird kein künstlicher Tag ergänzt.

Die Duckipedia-Seite enthält für alte Ausgaben außerdem Informationen zu Neuauflagen. Eine ISBN-/EAN-Zuordnung ist insbesondere für frühe LTBs nicht vollständig verfügbar; alte Ausgaben müssen deshalb teilweise über Nummer, Titel, Preisaufdruck und Druckmerkmale unterschieden werden.

## eBay-Marktwerte

Für die eBay Browse API werden Produktionsschlüssel als Cloudflare Secrets hinterlegt:

```bash
npx wrangler secret put EBAY_CLIENT_ID
npx wrangler secret put EBAY_CLIENT_SECRET
```

Die Suche nutzt Ausgabe, Nummer, Titel und bei manuellen Einzelabfragen mehrere Suchvarianten. Konvolute, Sammlungen, Sets und Pakete werden herausgefiltert.

Die Browse API liefert aktive Angebote, keine abgeschlossenen Verkäufe. Der angezeigte Durchschnitt ist deshalb ein aktueller Angebotsschnitt und keine belastbare Bewertung oder ein tatsächlich erzielter Verkaufspreis. eBay-Rate-Limits können den Initialimport pausieren; der gespeicherte Fortschritt kann später fortgesetzt werden.

## Sicherheit und Betrieb

- Keine Secrets in Git committen; `.dev.vars` ist per `.gitignore` ausgeschlossen.
- Passwort- und Sessiondaten werden nicht im Klartext gespeichert.
- Für den Produktivbetrieb sollte im Cloudflare Dashboard zusätzlich Rate Limiting für `/api/auth/*` aktiviert werden.
- Die Anwendung sollte ausschließlich über HTTPS betrieben werden, insbesondere wegen des Kamera- und Sessionzugriffs.
- Nach Änderungen immer `npm run check` und `npm run build` ausführen.

## Projektstruktur

```text
src/App.tsx                 React-Oberfläche und Kataloglogik
src/styles.css              Hauptdesign und responsive Layouts
functions/api/[[path]].ts   Worker-API und D1-Zugriffe
migrations/                 D1-Migrationen
public/                     Manifest und Service Worker
wrangler.jsonc              Cloudflare-Worker-Konfiguration
```
