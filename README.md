# FITStock → WhatsApp Alert

Lightweight scraper that polls the *Stockpick Gratis* section of
[fitstock.id](https://fitstock.id/#sec-spil) every 10 seconds and pushes any
new pick to a WhatsApp number in real time. Built for Dokploy (Docker) deployment.

## Stack

- **Node.js 20** (ES modules)
- **Playwright / Chromium** — renders the JS-driven section so the DOM is scrapable
- **Baileys** — connects directly to WhatsApp Web from your own WA Business number, no third-party gateway
- **Plain JSON file** for dedup state (picks are keyed by `ticker + pickTime`)
- **Tiny Node HTTP server** exposes `/qr` (one-time pairing) and `/health`

## How it works

1. On boot the service opens Chromium, loads the landing page, waits for the
   *Stockpick Gratis* heading, and extracts rows (ticker, name, % change,
   signal time, Buy/Sell, price).
2. The first successful poll is recorded as the **baseline** — nothing is sent.
   This prevents a flood of "old" alerts every time the container restarts.
3. Every `POLL_INTERVAL_MS` (default `10000`) it reloads the page, diffs the
   current picks against the baseline, and WhatsApps anything new.
4. Sent picks are persisted to `/data/state.json` so restarts don't re-send.

## One-time WhatsApp pairing

Baileys connects as a *linked device* on `WA_SENDER`. You pair once:

1. Start the service.
2. Open `http://<host>:3000/qr` in a browser.
3. On the phone with your sender number, open WhatsApp → Settings →
   **Linked devices** → **Link a device** → scan.
4. The session is stored in the `/data/wa-auth` volume so redeploys keep working.

## Local run

```bash
cp .env.example .env
# edit WA_SENDER and WA_TARGET (digits only, international, no +)

npm install
npx playwright install chromium
npm start
```

Visit `http://localhost:3000/qr` once to pair.

## Dokploy deployment

This repo is `docker-compose` ready.

1. Push to a Git repo Dokploy can pull.
2. In Dokploy create a **Compose** service pointing at `docker-compose.yml`.
3. Set env vars in the Dokploy UI (at minimum `WA_SENDER`, `WA_TARGET`).
4. Expose port `3000` (only needed long enough to pair via `/qr`; you can
   disable public access afterwards).
5. Deploy. Open `/qr`, scan once, done.

The `fitstock-data` named volume holds both the WhatsApp session and the
dedup state — keep it across redeploys so you don't have to re-pair.

## Environment variables

| Var | Default | Description |
|---|---|---|
| `TARGET_URL` | `https://fitstock.id/#sec-spil` | Page to scrape |
| `POLL_INTERVAL_MS` | `10000` | Poll interval, ms |
| `WA_SENDER` | *(required)* | Your sender WA number, digits only |
| `WA_TARGET` | *(required)* | Destination WA number, digits only |
| `HTTP_PORT` | `3000` | Port for `/qr` and `/health` |
| `NOTIFY_ON_STARTUP` | `false` | If `true`, send all currently-listed picks on first poll |
| `LOG_LEVEL` | `info` | pino log level |
| `DATA_DIR` | `/data` | Where auth + state are persisted |

## Notes & caveats

- **Be polite.** 10 s polling is aggressive. If fitstock.id returns throttling
  or blocks you, raise `POLL_INTERVAL_MS`.
- **Selector drift.** The scraper uses a content-based heuristic (finds the
  *Stockpick Gratis* heading, then parses rows with a regex for timestamp +
  Buy/Sell + price). If FITStock changes its layout, adjust `extractInPage`
  in `src/scraper.js`.
- **Unofficial WhatsApp.** Baileys uses the WhatsApp Web protocol. Sending
  high-frequency automated messages from a personal or business number
  carries a risk of bans from WhatsApp. This tool only sends on *new* picks
  (typically a handful per day), which is well within safe usage.
- **ToS.** Check fitstock.id's terms. This project is for personal use only.
