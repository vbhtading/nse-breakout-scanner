# HighBreak NSE Breakout Scanner

Next.js 16 + yahoo-finance2 scanner for:
- Daily: price > yesterday high + elevated volume
- Weekly: price > 5-day high + elevated volume
- Prominent Common (intersection) section

Key files:
- app/page.tsx — main UI, three result buckets, live scan, modal
- app/api/analyze/route.ts — fetches history + quote, returns breakout metrics
- lib/breakout-analyzer.ts — pure computation of isDailyBreak / isWeeklyBreak / volRatio / common
- lib/symbols.ts — exact user list (ETERNAL ... TATACAP)
- lib/utils.ts — formatters + concurrency helper

Build with `npm run build`. Deploy to Vercel directly.

Volume threshold is the only runtime control (shared). Concurrency kept low (5) for Yahoo friendliness.

All data via public Yahoo Finance endpoints. Short in-memory cache in the route.
