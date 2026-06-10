"use client";

import React, { useState, useMemo } from "react";
import {
  Play, RefreshCw, Download, Search, X, TrendingUp, Target, Zap, BarChart3, Clock
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Line, ComposedChart, Cell, ReferenceLine
} from "recharts";
import { format } from "date-fns";

import { NSE_UNIVERSE } from "@/lib/symbols";
import type { BreakoutAnalysis } from "@/lib/breakout-analyzer";
import { formatINR, formatNumber, formatPercent, runWithConcurrency } from "@/lib/utils";

// Types
type ScanResult = BreakoutAnalysis & { scannedAt: string };

const CONCURRENCY = 5; // Polite to Yahoo on Vercel
const DEFAULT_VOL_THRESHOLD = 1.65;

export default function NSEBreakoutScanner() {
  // Volume threshold (shared for both scanners)
  const [volThreshold, setVolThreshold] = useState(DEFAULT_VOL_THRESHOLD);

  // Scan state
  const [isScanning, setIsScanning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<ScanResult[]>([]);
  const [lastScan, setLastScan] = useState<Date | null>(null);

  // UI state
  const [searchTerm, setSearchTerm] = useState("");
  const [minVolOnly, setMinVolOnly] = useState(true);
  const [sortMode, setSortMode] = useState<"vol" | "aboveDaily" | "aboveWeekly">("vol");
  const [selectedStock, setSelectedStock] = useState<ScanResult | null>(null);

  // Derived
  const universeSize = NSE_UNIVERSE.length;

  // Three buckets
  const dailyBreaks = useMemo(
    () => results.filter(r => r.isDailyBreak),
    [results]
  );

  const weeklyBreaks = useMemo(
    () => results.filter(r => r.isWeeklyBreak),
    [results]
  );

  const commonBreaks = useMemo(
    () => results.filter(r => r.isCommonBreak),
    [results]
  );

  // Global search + filter applied to each section
  function applyFiltersAndSort(list: ScanResult[]) {
    let data = [...list];

    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      data = data.filter(r =>
        r.symbol.toLowerCase().includes(q) || (r.name || "").toLowerCase().includes(q)
      );
    }
    if (minVolOnly) {
      data = data.filter(r => r.volRatio >= volThreshold);
    }

    // sort
    data.sort((a, b) => {
      if (sortMode === "vol") {
        return (b.volRatio || 0) - (a.volRatio || 0);
      }
      if (sortMode === "aboveDaily") {
        return (b.aboveDailyHighPct || 0) - (a.aboveDailyHighPct || 0);
      }
      // aboveWeekly
      return (b.aboveWeekHighPct || 0) - (a.aboveWeekHighPct || 0);
    });

    return data;
  }

  const filteredDaily = useMemo(() => applyFiltersAndSort(dailyBreaks), [dailyBreaks, searchTerm, minVolOnly, volThreshold, sortMode]);
  const filteredWeekly = useMemo(() => applyFiltersAndSort(weeklyBreaks), [weeklyBreaks, searchTerm, minVolOnly, volThreshold, sortMode]);
  const filteredCommon = useMemo(() => applyFiltersAndSort(commonBreaks), [commonBreaks, searchTerm, minVolOnly, volThreshold, sortMode]);

  // Analyze single symbol (uses current volThreshold)
  async function analyzeOne(symbol: string): Promise<ScanResult | null> {
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          volThreshold,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.warn(`Analyze failed for ${symbol}:`, err);
        return null;
      }

      const data: BreakoutAnalysis = await res.json();
      return {
        ...data,
        scannedAt: new Date().toISOString(),
      };
    } catch (e) {
      console.error("Fetch error for", symbol, e);
      return null;
    }
  }

  // Full scan over the exact user list
  const startScan = async () => {
    if (isScanning) return;

    setIsScanning(true);
    setResults([]);
    setSearchTerm("");
    setProgress({ done: 0, total: universeSize });

    const symbols = NSE_UNIVERSE.map(s => s.symbol);
    const newResults: ScanResult[] = [];
    let doneCount = 0;

    const worker = async (sym: string) => {
      const result = await analyzeOne(sym);
      doneCount++;
      setProgress({ done: doneCount, total: universeSize });

      if (result) {
        newResults.push(result);
        // Live update UI
        setResults(prev => {
          const merged = [...prev, result];
          const dedup = Array.from(new Map(merged.map(r => [r.symbol, r])).values());
          return dedup;
        });
      }
    };

    try {
      await runWithConcurrency(symbols, CONCURRENCY, worker);

      setLastScan(new Date());

      const commonCount = newResults.filter(r => r.isCommonBreak).length;
      const dailyCount = newResults.filter(r => r.isDailyBreak).length;
      const weeklyCount = newResults.filter(r => r.isWeeklyBreak).length;

      if (commonCount > 0) {
        toast.success(`${commonCount} common breakouts found`, {
          description: `${dailyCount} daily • ${weeklyCount} weekly (vol ≥ ${volThreshold}×)`,
        });
      } else if (dailyCount + weeklyCount > 0) {
        toast.success(`${dailyCount + weeklyCount} breakouts detected`, {
          description: `${dailyCount} daily high • ${weeklyCount} weekly high`,
        });
      } else {
        toast.info("Scan complete — no stocks currently breaking above the reference highs with high volume.");
      }
    } catch (e) {
      toast.error("Scan encountered an error");
    } finally {
      setIsScanning(false);
      setProgress({ done: 0, total: 0 });
    }
  };

  const resetAll = () => {
    setResults([]);
    setLastScan(null);
    setProgress({ done: 0, total: 0 });
    setSearchTerm("");
    setMinVolOnly(true);
    toast("Dashboard reset");
  };

  // Export combined CSV of current view (prefers common, then daily+weekly)
  const exportCSV = () => {
    const toExport = [...filteredCommon, ...filteredDaily.filter(d => !d.isCommonBreak), ...filteredWeekly.filter(w => !w.isCommonBreak)];
    const unique = Array.from(new Map(toExport.map(r => [r.symbol, r])).values());

    if (unique.length === 0) {
      toast.error("No data to export");
      return;
    }

    const headers = [
      "Symbol", "Name", "LTP", "1D_Chg%", "Vol_Ratio", "Yest_High", "Above_Yest_%",
      "Week5d_High", "Above_Week_%", "Is_Daily", "Is_Weekly", "Is_Common", "AvgVol20d"
    ];

    const rows = unique.map(r => [
      r.symbol,
      `"${(r.name || r.symbol).replace(/"/g, '""')}"`,
      r.ltp,
      r.change1dPct,
      r.volRatio,
      r.yesterdayHigh,
      r.aboveDailyHighPct,
      r.weekHigh,
      r.aboveWeekHighPct,
      r.isDailyBreak ? "YES" : "NO",
      r.isWeeklyBreak ? "YES" : "NO",
      r.isCommonBreak ? "YES" : "NO",
      r.avgVolume20d,
    ]);

    const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `nse-breakouts_${format(new Date(), "yyyy-MM-dd_HHmm")}.csv`;
    link.click();
    URL.revokeObjectURL(url);

    toast.success(`Exported ${unique.length} breakout rows`);
  };

  const openDetail = (stock: ScanResult) => setSelectedStock(stock);

  // Chart data + reference levels for modal
  const chartData = useMemo(() => {
    if (!selectedStock?.recentCandles?.length) return [];
    return selectedStock.recentCandles.map((c) => {
      const ratio = selectedStock.avgVolume20d > 0 ? c.volume / selectedStock.avgVolume20d : 0;
      return {
        date: c.date.slice(5),
        close: Number(c.close.toFixed(2)),
        high: Number(c.high.toFixed(2)),
        volume: Math.round(c.volume),
        volRatio: Number(ratio.toFixed(2)),
      };
    });
  }, [selectedStock]);

  const chartYestHigh = selectedStock?.yesterdayHigh ?? null;
  const chartWeekHigh = selectedStock?.weekHigh ?? null;

  return (
    <div className="min-h-screen bg-[#0a0f1a] text-zinc-200">
      {/* Top Bar */}
      <div className="border-b border-white/10 bg-[#0a0f1a]/95 backdrop-blur-lg sticky top-0 z-50">
        <div className="max-w-[1480px] mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                <Target className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <div className="font-semibold tracking-tighter text-2xl">HighBreak</div>
                <div className="text-[10px] text-emerald-400/70 -mt-1">NSE • DAILY + WEEKLY HIGH SCANNER</div>
              </div>
            </div>
            <div className="ml-3 px-3 py-1 rounded-full bg-white/5 text-xs font-medium border border-white/10">
              Data via Yahoo Finance
            </div>
          </div>

          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-2 text-zinc-400">
              <Clock className="w-4 h-4" />
              {lastScan ? `Last scan: ${format(lastScan, "HH:mm")}` : "Ready to scan"}
            </div>
            <button
              onClick={resetAll}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-white/5 border border-white/10 text-xs"
            >
              <RefreshCw className="w-3.5 h-3.5" /> RESET
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-[1480px] mx-auto px-6 pt-8 pb-24">
        {/* Hero */}
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8">
          <div>
            <div className="uppercase tracking-[3px] text-emerald-400 text-xs font-semibold mb-1">CURATED UNIVERSE • PRICE & VOLUME BREAKOUTS</div>
            <h1 className="text-6xl font-semibold tracking-tighter">NSE High Breakout Scanner</h1>
            <p className="mt-3 max-w-2xl text-lg text-zinc-400">
              Scans your fixed list of <span className="font-semibold text-emerald-400">{universeSize} NSE stocks</span>.
              Finds stocks where <span className="font-medium text-white">current price &gt; yesterday high</span> or <span className="font-medium text-white">current price &gt; last 5-day high</span>, combined with elevated volume.
            </p>
            <div className="mt-2 text-xs text-zinc-500">Common stocks = appear in BOTH daily and weekly scanners with high volume.</div>
          </div>

          <div className="flex flex-col items-end gap-2">
            <button
              onClick={startScan}
              disabled={isScanning}
              className="flex items-center justify-center gap-3 px-8 h-14 rounded-2xl bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 disabled:bg-zinc-700 disabled:text-zinc-400 transition-all text-lg font-semibold shadow-lg shadow-emerald-950/50"
            >
              {isScanning ? (
                <>SCANNING… <RefreshCw className="w-5 h-5 animate-spin" /></>
              ) : (
                <> <Play className="w-5 h-5" /> SCAN ALL STOCKS </>
              )}
            </button>
            <div className="text-[11px] text-zinc-500">~50–90s • {CONCURRENCY} concurrent • Yahoo Finance</div>
          </div>
        </div>

        {/* Controls */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 mb-6">
          {/* Volume Threshold */}
          <div className="lg:col-span-5 card p-5">
            <div className="font-medium flex items-center gap-2 mb-4">
              <BarChart3 className="w-4 h-4 text-emerald-400" /> VOLUME THRESHOLD (SHARED)
            </div>

            <div>
              <div className="flex justify-between text-sm mb-2">
                <div>Minimum Volume Ratio</div>
                <div className="font-mono text-emerald-400 font-semibold">{volThreshold.toFixed(2)}×</div>
              </div>
              <input
                type="range" min={1.3} max={3.0} step={0.05}
                value={volThreshold}
                onChange={(e) => setVolThreshold(parseFloat(e.target.value))}
                className="w-full accent-emerald-500" disabled={isScanning}
              />
              <div className="flex justify-between text-[10px] text-zinc-500 mt-1">
                <div>1.3× (mild)</div><div>2.0× (strong)</div><div>3.0× (extreme)</div>
              </div>
              <div className="text-[11px] text-zinc-400 mt-3">
                A stock must have volume ≥ this multiple of its 20-day average to qualify for any scanner.
              </div>
            </div>
          </div>

          {/* Info */}
          <div className="lg:col-span-7 card p-5">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex-1">
                <div className="text-sm text-zinc-400 mb-1">CURATED UNIVERSE</div>
                <div className="text-3xl font-semibold tracking-tight">
                  {universeSize} <span className="text-base font-normal text-zinc-400">NSE stocks</span>
                </div>
                <div className="text-emerald-400/80 text-xs mt-0.5">
                  Daily = price &gt; yesterday high • Weekly = price &gt; 5-day high
                </div>
              </div>
              <div className="text-sm text-zinc-400 max-w-[360px]">
                Common stocks satisfy <span className="text-white font-medium">both</span> conditions with elevated volume. Ideal high-conviction candidates.
              </div>
            </div>
          </div>
        </div>

        {/* Progress */}
        <AnimatePresence>
          {isScanning && progress.total > 0 && (
            <div className="mb-6 card p-4">
              <div className="flex items-center justify-between mb-2 text-sm">
                <div className="font-medium flex items-center gap-2">
                  SCANNING IN PROGRESS
                  <span className="font-mono text-emerald-400">{progress.done} / {progress.total}</span>
                </div>
              </div>
              <div className="progress">
                <div className="progress-bar bg-emerald-500" style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
              </div>
              <div className="text-[11px] text-zinc-500 mt-1.5">
                Fetching daily history + live quote • Computing yesterday high, 5-day high, volume ratio vs 20d avg
              </div>
            </div>
          )}
        </AnimatePresence>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="card p-5">
            <div className="text-xs uppercase tracking-widest text-zinc-400">STOCKS SCANNED</div>
            <div className="text-5xl font-semibold tabular-nums mt-2">{results.length}</div>
            <div className="text-emerald-400 text-sm mt-1">out of {universeSize}</div>
          </div>

          <div className="card p-5 border-emerald-500/30">
            <div className="text-xs uppercase tracking-widest text-emerald-400">DAILY HIGH BREAKS</div>
            <div className="text-5xl font-semibold tabular-nums mt-2 text-emerald-400">{dailyBreaks.length}</div>
            <div className="text-sm mt-1 text-emerald-300/80">Price &gt; Yesterday High + Vol ≥ {volThreshold}×</div>
          </div>

          <div className="card p-5 border-sky-500/30">
            <div className="text-xs uppercase tracking-widest text-sky-400">WEEKLY HIGH BREAKS</div>
            <div className="text-5xl font-semibold tabular-nums mt-2 text-sky-400">{weeklyBreaks.length}</div>
            <div className="text-sm mt-1 text-sky-300/80">Price &gt; 5-Day High + Vol ≥ {volThreshold}×</div>
          </div>

          <div className="card p-5 border-amber-500/30 flex flex-col justify-between">
            <div>
              <div className="text-xs uppercase tracking-widest text-amber-400">COMMON (BOTH)</div>
              <div className="text-5xl font-semibold tabular-nums mt-2 text-amber-400">{commonBreaks.length}</div>
              <div className="text-sm mt-1 text-amber-300/80">Strongest confluence</div>
            </div>
            <button
              onClick={exportCSV}
              disabled={results.length === 0}
              className="mt-4 self-start flex items-center gap-2 text-xs px-4 h-9 rounded-xl border border-white/10 hover:bg-white/5 disabled:opacity-40"
            >
              <Download className="w-3.5 h-3.5" /> EXPORT CSV
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-3 px-1">
          <div className="font-semibold flex items-center gap-3 text-lg">
            RESULTS
            <span className="text-emerald-400 text-sm font-normal">({results.length} analyzed)</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-3 text-zinc-400" />
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search symbol or name..."
                className="pl-9 w-64 h-9 rounded-xl text-sm border border-white/10 focus:border-emerald-500/60"
              />
            </div>

            <button
              onClick={() => setMinVolOnly(!minVolOnly)}
              className={`h-9 px-4 rounded-xl text-xs font-medium border ${minVolOnly ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" : "border-white/10 hover:bg-white/5"}`}
            >
              VOL ≥ {volThreshold}×
            </button>

            <div className="flex items-center gap-1 text-xs pl-2 border-l border-white/10">
              <span className="text-zinc-400 mr-1">SORT</span>
              <button onClick={() => setSortMode("vol")} className={`px-3 h-8 rounded-lg border ${sortMode === "vol" ? "bg-white/10 border-white/30" : "border-white/10 hover:bg-white/5"}`}>Vol Ratio</button>
              <button onClick={() => setSortMode("aboveDaily")} className={`px-3 h-8 rounded-lg border ${sortMode === "aboveDaily" ? "bg-white/10 border-white/30" : "border-white/10 hover:bg-white/5"}`}>Above Yest</button>
              <button onClick={() => setSortMode("aboveWeekly")} className={`px-3 h-8 rounded-lg border ${sortMode === "aboveWeekly" ? "bg-white/10 border-white/30" : "border-white/10 hover:bg-white/5"}`}>Above Week</button>
            </div>

            <button onClick={() => { setSearchTerm(""); setMinVolOnly(true); }} className="h-9 px-3 text-xs border border-white/10 rounded-xl hover:bg-white/5">CLEAR</button>
          </div>
        </div>

        {/* ========== COMMON SECTION (PROMINENT) ========== */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2 px-1">
            <div className="uppercase text-xs tracking-[2px] font-semibold text-amber-400">COMMON BREAKOUTS — BOTH SCANNERS</div>
            <div className="text-[10px] px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">{filteredCommon.length}</div>
          </div>

          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="data-table w-full text-sm">
                <thead>
                  <tr className="table-header text-xs">
                    <th className="text-left pl-5 py-3">SYMBOL</th>
                    <th className="text-left py-3">NAME</th>
                    <th className="text-right py-3">LTP (₹)</th>
                    <th className="text-right py-3">VOL RATIO</th>
                    <th className="text-right py-3">ABOVE YEST HIGH</th>
                    <th className="text-right py-3">ABOVE 5D HIGH</th>
                    <th className="text-right py-3">1D CHG</th>
                    <th className="w-10 pr-4"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filteredCommon.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-zinc-400">
                        {results.length === 0 ? "Run a scan to see common breakouts here." : "No common breakouts match current filters."}
                      </td>
                    </tr>
                  )}
                  {filteredCommon.map((row) => (
                    <tr key={row.symbol} className="group bg-amber-950/10 hover:bg-amber-950/20">
                      <td className="pl-5 py-3 font-mono text-amber-300 font-semibold tracking-tight">{row.symbol}</td>
                      <td className="py-3 text-zinc-300 pr-4 max-w-[260px] truncate text-sm">{row.name}</td>
                      <td className="text-right py-3 tabular-nums font-medium">{formatINR(row.ltp)}</td>
                      <td className="text-right py-3">
                        <span className="font-semibold tabular-nums text-amber-400">{row.volRatio}×</span>
                      </td>
                      <td className="text-right py-3 text-emerald-400 font-medium tabular-nums">+{row.aboveDailyHighPct.toFixed(1)}%</td>
                      <td className="text-right py-3 text-sky-400 font-medium tabular-nums">+{row.aboveWeekHighPct.toFixed(1)}%</td>
                      <td className={`text-right py-3 tabular-nums ${row.change1dPct >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {formatPercent(row.change1dPct)}
                      </td>
                      <td className="pr-4">
                        <button onClick={() => openDetail(row)} className="opacity-70 group-hover:opacity-100 text-xs px-3 py-1 border border-white/10 rounded-lg hover:bg-white/5">DETAILS</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {commonBreaks.length > 0 && (
              <div className="px-4 py-2 text-[11px] text-amber-400/70 border-t border-white/10 bg-black/20">
                These stocks cleared both daily and weekly high breakouts on elevated volume.
              </div>
            )}
          </div>
        </div>

        {/* DAILY + WEEKLY side by side on large, stacked on mobile */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* DAILY BREAKOUTS */}
          <div>
            <div className="flex items-center gap-3 mb-2 px-1">
              <div className="uppercase text-xs tracking-[2px] font-semibold text-emerald-400">DAILY HIGH BREAKOUTS</div>
              <div className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">{filteredDaily.length}</div>
            </div>
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="data-table w-full text-sm">
                  <thead>
                    <tr className="table-header text-xs">
                      <th className="text-left pl-4 py-2.5">SYMBOL</th>
                      <th className="text-right py-2.5">LTP</th>
                      <th className="text-right py-2.5">YEST HIGH</th>
                      <th className="text-right py-2.5">ABOVE %</th>
                      <th className="text-right py-2.5 pr-4">VOL×</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {filteredDaily.length === 0 && (
                      <tr><td colSpan={5} className="py-10 text-center text-zinc-400 text-sm">No daily breakouts{results.length > 0 ? " in current view." : "."}</td></tr>
                    )}
                    {filteredDaily.map((row) => (
                      <tr key={row.symbol} className="group" onClick={() => openDetail(row)}>
                        <td className="pl-4 py-2.5 font-mono text-emerald-300 font-semibold cursor-pointer">{row.symbol}</td>
                        <td className="text-right py-2.5 tabular-nums font-medium cursor-pointer">{formatINR(row.ltp)}</td>
                        <td className="text-right py-2.5 tabular-nums text-zinc-400">{formatINR(row.yesterdayHigh)}</td>
                        <td className="text-right py-2.5 text-emerald-400 font-semibold tabular-nums">+{row.aboveDailyHighPct.toFixed(1)}%</td>
                        <td className="text-right py-2.5 pr-4">
                          <span className="font-semibold tabular-nums text-emerald-400">{row.volRatio}×</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* WEEKLY BREAKOUTS */}
          <div>
            <div className="flex items-center gap-3 mb-2 px-1">
              <div className="uppercase text-xs tracking-[2px] font-semibold text-sky-400">WEEKLY (5-DAY) HIGH BREAKOUTS</div>
              <div className="text-[10px] px-2 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20">{filteredWeekly.length}</div>
            </div>
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="data-table w-full text-sm">
                  <thead>
                    <tr className="table-header text-xs">
                      <th className="text-left pl-4 py-2.5">SYMBOL</th>
                      <th className="text-right py-2.5">LTP</th>
                      <th className="text-right py-2.5">5D HIGH</th>
                      <th className="text-right py-2.5">ABOVE %</th>
                      <th className="text-right py-2.5 pr-4">VOL×</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {filteredWeekly.length === 0 && (
                      <tr><td colSpan={5} className="py-10 text-center text-zinc-400 text-sm">No weekly breakouts{results.length > 0 ? " in current view." : "."}</td></tr>
                    )}
                    {filteredWeekly.map((row) => (
                      <tr key={row.symbol} className="group" onClick={() => openDetail(row)}>
                        <td className="pl-4 py-2.5 font-mono text-sky-300 font-semibold cursor-pointer">{row.symbol}</td>
                        <td className="text-right py-2.5 tabular-nums font-medium cursor-pointer">{formatINR(row.ltp)}</td>
                        <td className="text-right py-2.5 tabular-nums text-zinc-400">{formatINR(row.weekHigh)}</td>
                        <td className="text-right py-2.5 text-sky-400 font-semibold tabular-nums">+{row.aboveWeekHighPct.toFixed(1)}%</td>
                        <td className="text-right py-2.5 pr-4">
                          <span className="font-semibold tabular-nums text-sky-400">{row.volRatio}×</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 text-center text-xs text-zinc-500">
          Not financial advice. Highs are from completed trading days. Volume uses latest available (quote volume when market open).
        </div>
      </div>

      {/* DETAIL MODAL */}
      <AnimatePresence>
        {selectedStock && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4" onClick={() => setSelectedStock(null)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 18 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 18 }}
              transition={{ type: "spring", bounce: 0.01, duration: 0.18 }}
              onClick={e => e.stopPropagation()}
              className="modal w-full max-w-[1080px] bg-[#0f1629] border border-white/10 rounded-3xl overflow-hidden"
            >
              {/* Header */}
              <div className="px-7 pt-6 pb-4 flex items-start justify-between border-b border-white/10 bg-black/20">
                <div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="font-mono text-4xl font-semibold tracking-[-2px]">{selectedStock.symbol}</div>
                    {selectedStock.isCommonBreak && <span className="badge badge-amber mt-1">COMMON</span>}
                    {selectedStock.isDailyBreak && <span className="badge badge-green mt-1">DAILY HIGH</span>}
                    {selectedStock.isWeeklyBreak && <span className="badge badge-green mt-1">WEEKLY HIGH</span>}
                  </div>
                  <div className="text-zinc-400 text-lg mt-0.5">{selectedStock.name}</div>
                </div>
                <button onClick={() => setSelectedStock(null)} className="p-2 -mr-2 text-zinc-400 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-7 space-y-7">
                {/* Key Numbers */}
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                  {[
                    { label: "LTP", val: formatINR(selectedStock.ltp) },
                    { label: "1D Change", val: formatPercent(selectedStock.change1dPct), pos: selectedStock.change1dPct >= 0 },
                    { label: "Vol Ratio", val: `${selectedStock.volRatio}×`, highlight: true },
                    { label: "Yesterday High", val: formatINR(selectedStock.yesterdayHigh) },
                    { label: "5-Day High", val: formatINR(selectedStock.weekHigh) },
                  ].map((m, idx) => (
                    <div key={idx} className="rounded-2xl bg-black/30 border border-white/10 p-4">
                      <div className="text-[10px] tracking-widest text-zinc-400">{m.label}</div>
                      <div className={`mt-1.5 text-2xl font-semibold tabular-nums ${m.highlight ? "text-emerald-400" : m.pos === false ? "text-rose-400" : ""}`}>
                        {m.val}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Break metrics */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="rounded-2xl border border-emerald-500/20 bg-emerald-950/10 p-4">
                    <div className="text-xs uppercase tracking-widest text-emerald-400">DAILY BREAK</div>
                    <div className="mt-2 flex items-baseline gap-3">
                      <div className="text-4xl font-semibold tabular-nums text-emerald-400">+{selectedStock.aboveDailyHighPct.toFixed(1)}%</div>
                      <div className="text-sm text-zinc-400">above yesterday high</div>
                    </div>
                    <div className="text-xs mt-2 text-zinc-400">Yesterday High: {formatINR(selectedStock.yesterdayHigh)}</div>
                  </div>
                  <div className="rounded-2xl border border-sky-500/20 bg-sky-950/10 p-4">
                    <div className="text-xs uppercase tracking-widest text-sky-400">WEEKLY BREAK</div>
                    <div className="mt-2 flex items-baseline gap-3">
                      <div className="text-4xl font-semibold tabular-nums text-sky-400">+{selectedStock.aboveWeekHighPct.toFixed(1)}%</div>
                      <div className="text-sm text-zinc-400">above 5-day high</div>
                    </div>
                    <div className="text-xs mt-2 text-zinc-400">5-Day High: {formatINR(selectedStock.weekHigh)}</div>
                  </div>
                </div>

                {/* Chart */}
                {chartData.length > 3 && (
                  <div>
                    <div className="text-sm font-medium mb-2 px-1 flex items-center justify-between">
                      <span>RECENT PRICE ACTION + VOLUME (last {chartData.length} days)</span>
                      <span className="text-[10px] text-zinc-500">Green line = close • Bars = volume (vs 20d avg)</span>
                    </div>
                    <div className="chart-container p-3 border border-white/10 rounded-2xl h-[300px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={chartData}>
                          <CartesianGrid strokeDasharray="2 2" stroke="#1f2937" />
                          <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#64748b" }} />
                          <YAxis yAxisId="price" orientation="left" tick={{ fontSize: 10, fill: "#64748b" }} tickFormatter={(v) => "₹" + v} />
                          <YAxis yAxisId="vol" orientation="right" tick={{ fontSize: 10, fill: "#64748b" }} />
                          <Tooltip contentStyle={{ background: "#111827", border: "1px solid #334155", borderRadius: "8px" }} />
                          <Bar yAxisId="vol" dataKey="volume" fill="#10b981" opacity={0.7} name="Volume" />
                          <Line yAxisId="price" type="natural" dataKey="close" stroke="#34d399" strokeWidth={2.5} dot={false} name="Close" />
                          {chartYestHigh && (
                            <ReferenceLine yAxisId="price" y={chartYestHigh} stroke="#f59e0b" strokeDasharray="3 2" label={{ value: "Yest High", fill: "#f59e0b", fontSize: 10 }} />
                          )}
                          {chartWeekHigh && chartWeekHigh !== chartYestHigh && (
                            <ReferenceLine yAxisId="price" y={chartWeekHigh} stroke="#38bdf8" strokeDasharray="3 2" label={{ value: "Wk High", fill: "#38bdf8", fontSize: 10 }} />
                          )}
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="text-[10px] text-center text-zinc-500 mt-1.5">
                      Orange dashed = yesterday high • Blue dashed = 5-day high. Current price above both = common breakout candidate.
                    </div>
                  </div>
                )}

                {/* Quick facts */}
                <div className="text-sm text-zinc-300 border-l-2 border-emerald-500/40 pl-4 leading-relaxed">
                  Current price is <span className="font-semibold">{formatPercent(selectedStock.aboveDailyHighPct)}</span> above yesterday&apos;s high and <span className="font-semibold">{formatPercent(selectedStock.aboveWeekHighPct)}</span> above the 5-day high.
                  Latest volume is running at <span className="font-semibold text-emerald-400">{selectedStock.volRatio}×</span> the 20-day average.
                  {selectedStock.isCommonBreak && " This is a common breakout — strong confluence."}
                </div>
              </div>

              <div className="border-t border-white/10 bg-black/30 px-7 py-3.5 flex justify-end gap-3">
                <button onClick={() => setSelectedStock(null)} className="px-6 py-2 rounded-xl text-sm font-medium border border-white/10 hover:bg-white/5">CLOSE</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
