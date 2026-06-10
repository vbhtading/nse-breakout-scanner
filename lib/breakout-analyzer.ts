import { format } from "date-fns";

export interface DailyCandle {
  date: string;       // YYYY-MM-DD
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BreakoutAnalysis {
  symbol: string;
  name: string;
  ltp: number;                 // current / last traded price
  change1dPct: number;         // today's or latest % change from prev close

  // Volume
  avgVolume20d: number;
  currentVolume: number;
  volRatio: number;            // currentVol / avg20

  // Daily breakout (vs yesterday high)
  yesterdayHigh: number;
  aboveDailyHighPct: number;   // (ltp - yesterdayHigh) / yesterdayHigh * 100
  isDailyBreak: boolean;

  // Weekly breakout (vs last ~5 trading days high)
  weekHigh: number;            // max high over last 5 completed trading days
  aboveWeekHighPct: number;
  isWeeklyBreak: boolean;

  // Common
  isCommonBreak: boolean;      // both daily + weekly + sufficient volume

  // Context
  recentCandles: DailyCandle[]; // last ~15 for modal charts / context
  lastUpdated: string;
  tradingDaysAnalyzed: number;

  // Extra useful
  prevClose: number;
}

export interface AnalyzeOptions {
  volumeThreshold?: number;   // min volRatio to consider "high volume", default 1.6
  minAbovePct?: number;       // require at least this % above the ref high (default 0.01 for any break)
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function safePct(curr: number, ref: number): number {
  if (!ref || ref <= 0) return 0;
  return Number(((curr - ref) / ref) * 100);
}

function safeRatio(v: number, avg: number): number {
  if (!avg || avg <= 0) return 0;
  return Number((v / avg).toFixed(2));
}

export function analyzeBreakouts(
  symbol: string,
  name: string,
  ltp: number,
  change1d: number,
  candles: DailyCandle[],           // ascending by date, at least 6-7 days
  options: AnalyzeOptions = {}
): BreakoutAnalysis {
  const {
    volumeThreshold = 1.6,
    minAbovePct = 0.01,
  } = options;

  const insufficient = !candles || candles.length < 6;

  if (insufficient) {
    return emptyResult(symbol, name, ltp, change1d);
  }

  // Most recent completed day in history is typically "yesterday" (or last close)
  const lastCandle = candles[candles.length - 1];
  const prevCandle = candles[candles.length - 2];

  const yesterdayHigh = lastCandle.high;
  const prevClose = lastCandle.close;

  // Week high = max high over last min(5, available) completed days
  const weekWindow = Math.min(5, candles.length);
  const weekHigh = Math.max(...candles.slice(-weekWindow).map(c => c.high));

  // Volume baseline: avg of up to last 20 days, preferring older than the very latest few
  const volSeries = candles.map(c => c.volume);
  let baselineVols: number[] = [];
  if (candles.length > 5) {
    baselineVols = volSeries.slice(-Math.min(25, candles.length), -3);
  }
  const avgVolume20d = baselineVols.length >= 6 ? mean(baselineVols) : mean(volSeries.slice(0, -1));

  // Current volume: prefer live quote volume if we had it, but we use last historical + note that
  // For scanners, during market the API will use quote volume if available later.
  // Here we take the latest candle volume as "recent volume" and also allow override in caller.
  const currentVolume = lastCandle.volume; // will be overwritten by caller if fresh quote vol present
  const volRatio = safeRatio(currentVolume, avgVolume20d);

  // Break conditions
  const aboveDailyHighPct = Number(safePct(ltp, yesterdayHigh).toFixed(2));
  const aboveWeekHighPct = Number(safePct(ltp, weekHigh).toFixed(2));

  const isDailyBreak = ltp > yesterdayHigh && aboveDailyHighPct >= minAbovePct;
  const isWeeklyBreak = ltp > weekHigh && aboveWeekHighPct >= minAbovePct;

  const hasHighVolume = volRatio >= volumeThreshold;

  const isCommonBreak = isDailyBreak && isWeeklyBreak && hasHighVolume;

  return {
    symbol: symbol.replace(".NS", ""),
    name,
    ltp: Number(ltp.toFixed(2)),
    change1dPct: Number(change1d.toFixed(2)),
    avgVolume20d: Math.round(avgVolume20d),
    currentVolume: Math.round(currentVolume),
    volRatio,
    yesterdayHigh: Number(yesterdayHigh.toFixed(2)),
    aboveDailyHighPct,
    isDailyBreak: isDailyBreak && hasHighVolume, // require volume for "signal"
    weekHigh: Number(weekHigh.toFixed(2)),
    aboveWeekHighPct,
    isWeeklyBreak: isWeeklyBreak && hasHighVolume,
    isCommonBreak,
    recentCandles: candles.slice(-16),
    lastUpdated: new Date().toISOString(),
    tradingDaysAnalyzed: candles.length,
    prevClose: Number(prevClose.toFixed(2)),
  };
}

function emptyResult(symbol: string, name: string, ltp: number, change1d: number): BreakoutAnalysis {
  return {
    symbol: symbol.replace(".NS", ""),
    name,
    ltp: Number(ltp.toFixed(2)),
    change1dPct: Number(change1d.toFixed(2)),
    avgVolume20d: 0,
    currentVolume: 0,
    volRatio: 0,
    yesterdayHigh: 0,
    aboveDailyHighPct: 0,
    isDailyBreak: false,
    weekHigh: 0,
    aboveWeekHighPct: 0,
    isWeeklyBreak: false,
    isCommonBreak: false,
    recentCandles: [],
    lastUpdated: new Date().toISOString(),
    tradingDaysAnalyzed: 0,
    prevClose: 0,
  };
}

export function formatDateShort(isoDate: string): string {
  try {
    return format(new Date(isoDate), "dd MMM");
  } catch {
    return isoDate;
  }
}
