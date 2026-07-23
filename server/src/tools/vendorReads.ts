import type { ReadToolResult, ToolError } from '@dairy/shared';
import {
  allVendors,
  deliveriesForVendor,
  deliveriesInScope,
  getVendorById,
} from '../db';

type Args = Record<string, unknown>;

const round2 = (n: number) => Math.round(n * 100) / 100;

// --- list_vendors -----------------------------------------------------------
export function listVendors(args: Args): ReadToolResult {
  const status = typeof args.status === 'string' ? args.status : undefined;
  const vendors = allVendors().filter((v) => !status || v.status === status);
  return {
    modelDigest: {
      count: vendors.length,
      vendors: vendors.map((v) => ({
        id: v.id,
        name: v.name,
        status: v.status,
        price_per_litre: v.price_per_litre,
      })),
    },
  };
}

// --- get_vendor (detail + running balance + recent deliveries) --------------
export function getVendor(args: Args): ReadToolResult {
  const vendorId = String(args.vendor_id ?? '');
  const vendor = getVendorById(vendorId);
  if (!vendor) {
    return { modelDigest: { error: 'unknown_vendor', vendor_id: vendorId } satisfies ToolError };
  }

  const deliveries = deliveriesForVendor(vendorId); // newest first
  const unpaid = deliveries.filter((d) => !d.paid);
  const outstandingBalance = unpaid.reduce((s, d) => s + d.litres * d.price_per_litre, 0);
  const totalLitres = deliveries.reduce((s, d) => s + d.litres, 0);

  return {
    modelDigest: {
      vendor,
      outstandingBalance: round2(outstandingBalance),
      unpaidDeliveries: unpaid.length,
      totalDeliveries: deliveries.length,
      totalLitresDelivered: round2(totalLitres),
      lastDeliveryDate: deliveries[0]?.date ?? null,
      recentDeliveries: deliveries.slice(0, 10),
    },
  };
}

// --- get_deliveries (date-range for one vendor or all) ----------------------
export function getDeliveries(args: Args): ReadToolResult {
  const vendor_id = typeof args.vendor_id === 'string' ? args.vendor_id : undefined;
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
  if (vendor_id && !getVendorById(vendor_id)) {
    return { modelDigest: { error: 'unknown_vendor', vendor_id } satisfies ToolError };
  }

  const rows = deliveriesInScope({ vendorId: vendor_id, from, to });
  const totalLitres = rows.reduce((s, d) => s + d.litres, 0);
  const totalValue = rows.reduce((s, d) => s + d.litres * d.price_per_litre, 0);
  const unpaidValue = rows
    .filter((d) => !d.paid)
    .reduce((s, d) => s + d.litres * d.price_per_litre, 0);

  // Per-vendor breakdown (a handful of vendors, so this stays small).
  const byVendor = new Map<string, { litres: number; value: number; count: number }>();
  for (const d of rows) {
    const cur = byVendor.get(d.vendor_id) ?? { litres: 0, value: 0, count: 0 };
    cur.litres += d.litres;
    cur.value += d.litres * d.price_per_litre;
    cur.count += 1;
    byVendor.set(d.vendor_id, cur);
  }

  return {
    modelDigest: {
      scope: vendor_id ?? 'all vendors',
      from,
      to,
      count: rows.length,
      totalLitres: round2(totalLitres),
      totalValue: round2(totalValue),
      unpaidValue: round2(unpaidValue),
      byVendor: [...byVendor.entries()].map(([id, v]) => ({
        vendor_id: id,
        litres: round2(v.litres),
        value: round2(v.value),
        deliveries: v.count,
      })),
    },
  };
}

export const VENDOR_READ_EXECUTORS: Record<string, (args: Args) => ReadToolResult> = {
  list_vendors: listVendors,
  get_vendor: getVendor,
  get_deliveries: getDeliveries,
};
