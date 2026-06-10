# HighBreak — NSE Daily + Weekly High Breakout Scanner

A clean, fast Next.js app (Vercel-ready) that scans a **fixed curated list of NSE stocks** for price breakouts above key reference highs **with elevated volume**.

## Two Scanners + Common Stocks

1. **Daily High Breakouts** — Current price > Yesterday's high + high volume
2. **Weekly High Breakouts** — Current price > 5-Day high + high volume
3. **Common Breakouts** (highlighted) — Stocks that appear in **both** scanners above (strong confluence)

## Universe

Exactly the stocks you provided (ETERNAL first, then HINDZINC, IOC, BHEL, BPCL, GMRAIRPORT, JSWENERGY ... TATACAP).

## Volume Condition

Configurable volume ratio (default 1.65×). Volume ratio = latest volume ÷ 20-day average volume (uses live quote volume when available).

## Tech Stack

- Next.js 16 (App Router) + TypeScript
- yahoo-finance2 (historical daily + real-time quotes)
- Recharts for mini price+volume charts with reference lines
- Tailwind + Framer Motion + Sonner
- Progressive scan with live result updates (concurrency limited)

## Local Development

```bash
cd nse-breakout-scanner
npm install
npm run dev
```

Open http://localhost:3000 and click the big green **SCAN ALL STOCKS** button.

> **Note**: `npm run dev` now forces the stable classic Webpack dev server (`--webpack`) by default. This is much more reliable on Windows and after folder copies.  
> For the faster (but sometimes unstable) Turbopack: `npm run dev:turbo`

### If it gets stuck on "Compiling / ..."

This can happen on first run, especially on Windows or when the folder was copied with an old `node_modules`.

Run this:

```bash
cd nse-breakout-scanner

# Full clean reinstall (recommended)
rm -rf .next node_modules package-lock.json
npm install

npm run dev
```

To manually force the stable dev server:
```bash
npx next dev --webpack
```

## Deploy to Vercel

1. Push this folder to GitHub.
2. Import the repo in Vercel.
3. Deploy (no extra config needed — pure serverless API routes + Yahoo calls).

The app is designed to work well on Vercel's hobby plan. Yahoo Finance calls are cached briefly per symbol.

## Features

- One shared volume threshold slider
- Prominent "Common" section (stocks breaking both daily & weekly highs)
- Side-by-side Daily and Weekly tables
- Search + filter + multiple sort options
- Rich detail modal with chart + reference highs drawn
- CSV export of all current signals
- Live updating during scan
- In-memory caching (friendly to Yahoo rate limits)

## Data Notes

- Reference highs come from completed daily candles.
- "Current price" uses the latest regularMarketPrice (works during market hours).
- Volume uses `regularMarketVolume` from quote (today's running volume).
- Some newer or low-liquidity symbols may occasionally have sparse history.

## Disclaimer

This is an educational / informational tool only. **Not investment advice.** Do your own due diligence.

---

Built for your exact stock list. Ready for Vercel.