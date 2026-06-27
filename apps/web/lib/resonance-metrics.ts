/**
 * resonance-metrics.ts — Lightweight in-process metrics for the
 * Resonance HNSW pipeline.
 *
 * No external deps. All counters are process-lifetime (reset on deploy).
 * Exposed via /api/resonance/metrics for observability.
 */

// ── Counter types ──────────────────────────────────────────────────────────

interface HistogramEntry {
  count: number;
  sum: number;
  min: number;
  max: number;
}

const histograms = new Map<string, HistogramEntry>();
const counters = new Map<string, number>();
const gauges = new Map<string, number>();
const events: Array<{ ts: number; event: string; detail?: string }> = [];

// ── Public API ─────────────────────────────────────────────────────────────

export function observeLatencyMs(label: string, ms: number): void {
  const e = histograms.get(label) || { count: 0, sum: 0, min: Infinity, max: -Infinity };
  e.count++;
  e.sum += ms;
  if (ms < e.min) e.min = ms;
  if (ms > e.max) e.max = ms;
  histograms.set(label, e);
}

export function incCounter(label: string, n = 1): void {
  counters.set(label, (counters.get(label) || 0) + n);
}

export function setGauge(label: string, value: number): void {
  gauges.set(label, value);
}

export function recordEvent(event: string, detail?: string): void {
  events.push({ ts: Date.now(), event, detail });
  if (events.length > 200) events.shift(); // ring buffer
}

// ── Snapshot (for the /metrics endpoint) ────────────────────────────────────

export interface MetricsSnapshot {
  uptime_s: number;
  histograms: Record<string, HistogramEntry & { avg: number }>;
  counters: Record<string, number>;
  gauges: Record<string, number>;
  recent_events: Array<{ ts: number; event: string; detail?: string }>;
}

const startTime = Date.now();

export function getMetricsSnapshot(): MetricsSnapshot {
  const hists: Record<string, HistogramEntry & { avg: number }> = {};
  for (const [k, v] of Array.from(histograms)) {
    hists[k] = { ...v, avg: v.count > 0 ? v.sum / v.count : 0 };
  }
  return {
    uptime_s: (Date.now() - startTime) / 1000,
    histograms: hists,
    counters: Object.fromEntries(Array.from(counters)),
    gauges: Object.fromEntries(Array.from(gauges)),
    recent_events: events.slice(-50),
  };
}
