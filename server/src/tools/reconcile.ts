import type { ReadToolResult, ToolError } from '@dairy/shared';
import { sumDeliveredLitres, sumMilkYield } from '../db';
import type { ToolSchema } from './index';

type Args = Record<string, unknown>;

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Tolerance (percent) beyond which a produced-vs-delivered gap is flagged. */
export const RECONCILE_TOLERANCE_PCT = 5;

// --- get_yield_vs_deliveries ------------------------------------------------
// The one read tool that spans both agents' domains: it sums milk produced
// (milkings) and milk delivered (deliveries) over a range and reports the gap.
// A real discrepancy means something -- spoilage, unlogged home consumption, a
// measurement gap, or a data-entry error.
export function getYieldVsDeliveries(args: Args): ReadToolResult {
  const from = String(args.from ?? '');
  const to = String(args.to ?? '');
  if (!from || !to) {
    return {
      modelDigest: {
        error: 'missing_range',
        message: 'Both from and to (YYYY-MM-DD) are required.',
      } satisfies ToolError,
    };
  }

  const producedLitres = sumMilkYield(from, to);
  const deliveredLitres = sumDeliveredLitres(from, to);
  const discrepancyLitres = producedLitres - deliveredLitres;
  const hasProduction = producedLitres > 0;
  const discrepancyPct = hasProduction ? (discrepancyLitres / producedLitres) * 100 : null;
  // With no production, %-of-production is undefined -- but if milk was still
  // delivered, that IS a real (maximal) discrepancy and must be flagged, not
  // silently reported as 0%/ok. Otherwise the tool passes its worst-case input.
  const flagged = hasProduction
    ? Math.abs(discrepancyPct as number) > RECONCILE_TOLERANCE_PCT
    : deliveredLitres > 0;

  return {
    modelDigest: {
      from,
      to,
      producedLitres: round1(producedLitres),
      deliveredLitres: round1(deliveredLitres),
      discrepancyLitres: round1(discrepancyLitres),
      discrepancyPct: discrepancyPct === null ? null : round1(discrepancyPct),
      tolerancePct: RECONCILE_TOLERANCE_PCT,
      flagged,
    },
  };
}

export const RECONCILE_TOOLS: ToolSchema[] = [
  {
    name: 'get_yield_vs_deliveries',
    description:
      'Reconcile milk produced against milk delivered over a date range. Sums milking yield and vendor deliveries and returns both totals, the discrepancy (litres and percent), and a flagged boolean when the gap exceeds tolerance (5%). Use for questions like "does the milk we produce match what we deliver?". A positive discrepancy means more was produced than delivered (possible spoilage, home use, or unlogged sales).',
    input_schema: {
      type: 'object',
      required: ['from', 'to'],
      properties: {
        from: { type: 'string', description: 'ISO date YYYY-MM-DD' },
        to: { type: 'string', description: 'ISO date YYYY-MM-DD' },
      },
    },
  },
];

export const RECONCILE_EXECUTORS: Record<string, (args: Args) => ReadToolResult> = {
  get_yield_vs_deliveries: getYieldVsDeliveries,
};
