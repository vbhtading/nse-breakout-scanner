import { NextRequest, NextResponse } from "next/server";
import YahooFinance from "yahoo-finance2";
import { analyzeBreakouts, DailyCandle } from "@/lib/breakout-analyzer";
import { toYahooSymbol } from "@/lib/symbols";

const yahoo = new YahooFinance();

// In-memory short cache (per symbol) — kind to Yahoo + faster repeated scans
const cache = new Map<string, { data: any; ts: number }>(); 
const CACHE_TTL_MS = 1000 * 60 * 1.5; // 90 seconds

interface AnalyzeRequest {
  symbol: string;           // e.g. HINDZINC or HINDZINC.NS
  volThreshold?: number;    // minimum volume ratio, default 1.6
}

export async function POST(req: NextRequest) {
  try {
    const body: AnalyzeRequest = await req.json();
    const rawSymbol = (body.symbol || "").toUpperCase().trim();
    if (!rawSymbol) {
      return NextResponse.json({ error: "Symbol is required" }, { status: 400 });
    }

    const ySymbol = toYahooSymbol(rawSymbol);

    // Check cache
    const cached = cache.get(ySymbol);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return NextResponse.json(cached.data);
    }

    // Fetch sufficient daily history (~ 30-40 trading days)
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 80);

    const hist = await yahoo.historical(ySymbol, {
      period1: start,
      period2: end,
      interval: "1d",
    });

    if (!hist || hist.length === 0) {
      return NextResponse.json({ error: `No historical data for ${rawSymbol}` }, { status: 404 });
    }

    // Normalize candles (ascending)
    const candles: DailyCandle[] = hist
      .filter((r: any) => r.close != null && r.volume != null)
      .map((r: any) => ({
        date: r.date.toISOString().slice(0, 10),
        timestamp: r.date.getTime(),
        open: r.open,
        high: r.high,
        low: r.low,
        close: r.close,
        volume: r.volume,
      }))
      .sort((a, b) => a.timestamp - b.timestamp);

    // Latest quote for live price + volume (today's cumulative volume is very useful) + name
    let ltp = candles[candles.length - 1]?.close ?? 0;
    let change1d = 0;
    let displayName = rawSymbol;
    let liveVolume: number | null = null;

    try {
      const quote: any = await yahoo.quote(ySymbol);
      if (quote?.regularMarketPrice != null) ltp = quote.regularMarketPrice;
      if (quote?.regularMarketChangePercent != null) change1d = quote.regularMarketChangePercent;
      if (quote?.shortName) displayName = quote.shortName;
      if (quote?.regularMarketVolume != null) liveVolume = quote.regularMarketVolume;
    } catch (e) {
      // graceful fallback
      const prev = candles[candles.length - 2];
      if (prev && ltp) change1d = ((ltp - prev.close) / prev.close) * 100;
    }

    // Use live volume for current if we have it (important for intraday volume surge detection)
    const analysisInputCandles = [...candles];
    if (liveVolume != null && analysisInputCandles.length > 0) {
      // Replace the volume of the most recent candle with live volume for "current volume" comparisons
      analysisInputCandles[analysisInputCandles.length - 1] = {
        ...analysisInputCandles[analysisInputCandles.length - 1],
        volume: liveVolume,
      };
    }

    const volThreshold = body.volThreshold ?? 1.6;

    const result = analyzeBreakouts(
      rawSymbol,
      displayName,
      ltp,
      change1d,
      analysisInputCandles,
      {
        volumeThreshold: volThreshold,
        minAbovePct: 0.01, // tiny buffer so pure equality doesn't trigger
      }
    );

    // Store in cache
    cache.set(ySymbol, { data: result, ts: Date.now() });

    return NextResponse.json(result);
  } catch (err: any) {
    console.error("Analyze error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to analyze symbol" },
      { status: 500 }
    );
  }
}
