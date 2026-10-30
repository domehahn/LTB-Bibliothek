# LTB Bibliothek

Eine private, Cloudflare-geeignete Bibliotheksoberfläche für die Sammlung der Lustigen Taschenbücher.

## Enthalten

- eigener Login ohne Zitadel; Benutzer werden administrativ angelegt
- 618 LTB-Hauptausgaben mit Erscheinungsjahr, Variante und grobem Schätzwert
- Besitzstatus zum Abhaken, fehlende Ausgaben als Wunschliste und Suche/Filter
- Detailansicht mit Hinweis, dass Marktwerte nur Orientierung sind
- responsives Dashboard für Desktop und Mobilgeräte
- `schema.sql` als D1-Grundlage für Benutzer, Ausgaben und persönliche Sammlungsdaten

## Lokal starten

```bash
npm install
npm run dev
```

Die produktive Variante speichert Login-Session und Sammlung serverseitig in D1. Die Session selbst liegt ausschließlich als gehashter Token in der Datenbank; der Browser erhält nur ein HttpOnly-Cookie.

## Cloudflare Produktionsbetrieb

Der Build wird mit `npm run build` nach `dist/` geschrieben. `wrangler.jsonc` ist für Cloudflare Pages mit einer D1-Bindung vorbereitet.

1. D1-Datenbank anlegen: `npx wrangler d1 create ltb-bibliothek`
2. Die ausgegebene Datenbank-ID in `wrangler.jsonc` bei `database_id` eintragen.
3. Migration anwenden: `npx wrangler d1 migrations apply ltb-bibliothek --remote`
4. Bauen und deployen: `npm run build && npx wrangler deploy`

Die produktive Instanz läuft unter: https://ltb-bibliothek.squora.workers.dev

Die API liegt unter `functions/api/[[path]].ts`. Sie verwendet vorbereitete D1-Statements, PBKDF2-SHA-256 mit zufälligem Salt und gehashte Session-Tokens. Für Produktion sollte zusätzlich im Cloudflare Dashboard eine Rate-Limiting-Regel für `/api/auth/*` aktiviert und die eigene Domain mit HTTPS verwendet werden.

Die Marktwerte sind grobe Schätzwerte und keine automatisch aktualisierten Verkaufspreise.

## eBay-Angebotspreise

Die Detailansicht kann aktive eBay-Festpreisangebote über die Browse API abfragen und daraus Durchschnitt, Median und Beispielangebote berechnen. Dafür müssen die eBay-Production-Secrets einmalig gesetzt werden:

```bash
npx wrangler secret put EBAY_CLIENT_ID
npx wrangler secret put EBAY_CLIENT_SECRET
```

Die Browse API liefert aktuelle Angebote, keine abgeschlossenen Verkäufe; der angezeigte Wert ist daher ein Angebotsschnitt und kein realisierter Verkaufspreis.
