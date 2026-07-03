import { randomUUID } from 'node:crypto';
import type { Dataset, Interval, Milking } from '@dairy/shared';

export interface ShapeInput {
  rows: Milking[];
  animalCount: number;
  scopeLabel: string;
  from: string;
  to: string;
  requestedInterval: Interval;
}

export interface ShapeDigest {
  datasetId: string;
  scopeLabel: string;
  interval: Interval;
  requestedInterval: Interval;
  coarsened: boolean;
  coarsenNote?: string;
  from: string;
  to: string;
  bucketCount: number;
  totalLitres: number;
  meanBucketLitres: number;
  min: { periodStart: string; litres: number } | null;
  max: { periodStart: string; litres: number } | null;
  first: { periodStart: string; litres: number } | null;
  last: { periodStart: string; litres: number } | null;
  periodOverPeriodPct: number | null;
}

export interface ShapeResult {
  digest: ShapeDigest;
  dataset: Dataset;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1;
}

/**
 * Deterministic interval coarsening cap (principle #4): a caller asking for
 * `day` over a long range would blow up the dataset, so we coarsen before
 * doing any work.
 */
export function coarsenInterval(
  requested: Interval,
  rangeDays: number,
): { interval: Interval; coarsened: boolean; note?: string } {
  if (requested === 'day') {
    if (rangeDays > 365) {
      return { interval: 'month', coarsened: true, note: 'Range > 365 days: coarsened from day to month.' };
    }
    if (rangeDays > 90) {
      return { interval: 'week', coarsened: true, note: 'Range > 90 days: coarsened from day to week.' };
    }
  }
  if (requested === 'week' && rangeDays > 365) {
    return { interval: 'month', coarsened: true, note: 'Range > 365 days: coarsened from week to month.' };
  }
  return { interval: requested, coarsened: false };
}

function bucketKey(date: string, interval: Interval): string {
  const d = new Date(date + 'T00:00:00Z');
  if (interval === 'day') return date;
  if (interval === 'week') {
    // ISO-ish: snap to the Monday of the week.
    const day = d.getUTCDay(); // 0=Sun
    const diff = (day + 6) % 7; // days since Monday
    d.setUTCDate(d.getUTCDate() - diff);
    return d.toISOString().slice(0, 10);
  }
  // month
  return date.slice(0, 7) + '-01';
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function shapeMilkYield(input: ShapeInput): ShapeResult {
  const { rows, animalCount, scopeLabel, from, to, requestedInterval } = input;
  const rangeDays = daysBetween(from, to);
  const { interval, coarsened, note } = coarsenInterval(requestedInterval, rangeDays);

  // Bucket rows by interval.
  const buckets = new Map<string, { total: number; sessions: number }>();
  for (const r of rows) {
    const key = bucketKey(r.date, interval);
    const b = buckets.get(key) ?? { total: 0, sessions: 0 };
    b.total += r.yield_litres;
    b.sessions += 1;
    buckets.set(key, b);
  }

  const sortedKeys = [...buckets.keys()].sort();
  const points = sortedKeys.map((periodStart) => {
    const b = buckets.get(periodStart)!;
    return {
      periodStart,
      totalLitres: round2(b.total),
      avgPerAnimal: animalCount > 0 ? round2(b.total / animalCount) : 0,
      sessions: b.sessions,
    };
  });

  // --- Digest stats (the only thing the model sees) ---
  const totalLitres = round2(points.reduce((s, p) => s + p.totalLitres, 0));
  const bucketCount = points.length;
  const meanBucketLitres = bucketCount > 0 ? round2(totalLitres / bucketCount) : 0;

  let min: ShapeDigest['min'] = null;
  let max: ShapeDigest['max'] = null;
  for (const p of points) {
    if (!min || p.totalLitres < min.litres) min = { periodStart: p.periodStart, litres: p.totalLitres };
    if (!max || p.totalLitres > max.litres) max = { periodStart: p.periodStart, litres: p.totalLitres };
  }
  const first = points.length ? { periodStart: points[0].periodStart, litres: points[0].totalLitres } : null;
  const last = points.length ? { periodStart: points[points.length - 1].periodStart, litres: points[points.length - 1].totalLitres } : null;

  // period-over-period: second half vs first half of the buckets.
  let periodOverPeriodPct: number | null = null;
  if (bucketCount >= 2) {
    const mid = Math.floor(bucketCount / 2);
    const firstHalf = points.slice(0, mid);
    const secondHalf = points.slice(mid);
    const sum = (arr: typeof points) => arr.reduce((s, p) => s + p.totalLitres, 0);
    const firstAvg = sum(firstHalf) / Math.max(1, firstHalf.length);
    const secondAvg = sum(secondHalf) / Math.max(1, secondHalf.length);
    if (firstAvg > 0) {
      periodOverPeriodPct = round2(((secondAvg - firstAvg) / firstAvg) * 100);
    }
  }

  const datasetId = `ds_${randomUUID().slice(0, 8)}`;

  const dataset: Dataset = {
    datasetId,
    kind: 'timeseries',
    scopeLabel,
    interval,
    points: points.map((p) => ({
      periodStart: p.periodStart,
      totalLitres: p.totalLitres,
      avgPerAnimal: p.avgPerAnimal,
    })),
  };

  const digest: ShapeDigest = {
    datasetId,
    scopeLabel,
    interval,
    requestedInterval,
    coarsened,
    coarsenNote: note,
    from,
    to,
    bucketCount,
    totalLitres,
    meanBucketLitres,
    min,
    max,
    first,
    last,
    periodOverPeriodPct,
  };

  return { digest, dataset };
}
