import { randomUUID } from 'node:crypto';
import type { PendingWrite } from '@dairy/shared';
import { db, getDeliveryById, getVendorById } from '../db';
import type { WriteExecutor } from './writes';

type Args = Record<string, unknown>;

function vendorLabel(vendorId: string): string {
  const v = getVendorById(vendorId);
  return v ? v.name : vendorId;
}

// --- register_vendor --------------------------------------------------------
const registerVendor: WriteExecutor = {
  execute(args) {
    const name = String(args.name ?? '').trim();
    if (!name) throw new Error('vendor name is required');
    const price = Number(args.price_per_litre);
    if (!Number.isFinite(price) || price < 0) {
      throw new Error(`invalid price_per_litre: ${String(args.price_per_litre)}`);
    }
    // Whitelist against VendorStatus so a stray value can't make the vendor
    // invisible to list_vendors' status filter; default to active.
    const status = args.status === 'inactive' ? 'inactive' : 'active';
    const id = `vendor_${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO vendors (id, name, contact, price_per_litre, status)
       VALUES (@id, @name, @contact, @price_per_litre, @status)`,
    ).run({
      id,
      name,
      contact: args.contact != null ? String(args.contact) : null,
      price_per_litre: price,
      status,
    });
    return { created: true, id, name };
  },
  buildCard(toolUseId, args) {
    const status = typeof args.status === 'string' ? args.status : 'active';
    return {
      toolUseId,
      toolName: 'register_vendor',
      summary: `Register vendor "${String(args.name)}" at ${Number(args.price_per_litre)}/L (${status})`,
      details: [
        { label: 'Name', value: String(args.name) },
        { label: 'Contact', value: args.contact ? String(args.contact) : '-' },
        { label: 'Price / litre', value: String(Number(args.price_per_litre)) },
        { label: 'Status', value: status },
      ],
    };
  },
};

// --- record_delivery --------------------------------------------------------
// One vendor, one quantity per call. price_per_litre is captured from the
// vendor at delivery time so a later price change never rewrites history.
const recordDelivery: WriteExecutor = {
  execute(args) {
    const vendorId = String(args.vendor_id);
    const vendor = getVendorById(vendorId);
    // guardIds already rejects an unknown vendor_id before execute; this is a
    // defensive backstop so we never insert with a bad/zero price.
    if (!vendor) throw new Error(`unknown vendor: ${vendorId}`);
    const litres = Number(args.litres);
    if (!Number.isFinite(litres) || litres <= 0) {
      throw new Error(`invalid litres: ${String(args.litres)}`);
    }
    const price = vendor.price_per_litre;
    const id = `delivery_${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO deliveries (id, vendor_id, date, litres, price_per_litre, paid)
       VALUES (@id, @vendor_id, @date, @litres, @price_per_litre, 0)`,
    ).run({
      id,
      vendor_id: vendorId,
      date: String(args.date),
      litres,
      price_per_litre: price,
    });
    return {
      created: true,
      id,
      litres,
      price_per_litre: price,
      value: Math.round(litres * price * 100) / 100,
    };
  },
  buildCard(toolUseId, args) {
    const vendorId = String(args.vendor_id);
    const vendor = getVendorById(vendorId);
    const price = vendor?.price_per_litre ?? 0;
    const litres = Number(args.litres);
    const value = Number.isFinite(litres) ? Math.round(litres * price * 100) / 100 : 0;
    return {
      toolUseId,
      toolName: 'record_delivery',
      summary: `Record delivery of ${litres} L to ${vendorLabel(vendorId)} on ${String(args.date)} (${value} at ${price}/L)`,
      details: [
        { label: 'Vendor', value: vendorLabel(vendorId) },
        { label: 'Date', value: String(args.date) },
        { label: 'Litres', value: `${litres} L` },
        { label: 'Price / litre', value: String(price) },
        { label: 'Value', value: String(value) },
      ],
    };
  },
};

// --- mark_delivery_paid -----------------------------------------------------
const markDeliveryPaid: WriteExecutor = {
  execute(args) {
    const deliveryId = String(args.delivery_id);
    const info = db
      .prepare(`UPDATE deliveries SET paid = 1 WHERE id = ?`)
      .run(deliveryId);
    return { updated: info.changes, delivery_id: deliveryId };
  },
  buildCard(toolUseId, args) {
    const deliveryId = String(args.delivery_id);
    const d = getDeliveryById(deliveryId);
    const details = [{ label: 'Delivery', value: deliveryId }];
    if (d) {
      details.push(
        { label: 'Vendor', value: vendorLabel(d.vendor_id) },
        { label: 'Date', value: d.date },
        { label: 'Litres', value: `${d.litres} L` },
        { label: 'Value', value: String(Math.round(d.litres * d.price_per_litre * 100) / 100) },
      );
    }
    return {
      toolUseId,
      toolName: 'mark_delivery_paid',
      summary: d
        ? `Mark ${d.litres} L delivery to ${vendorLabel(d.vendor_id)} (${d.date}) as paid`
        : `Mark delivery ${deliveryId} as paid`,
      details,
    };
  },
};

export const VENDOR_WRITE_EXECUTORS: Record<string, WriteExecutor> = {
  register_vendor: registerVendor,
  record_delivery: recordDelivery,
  mark_delivery_paid: markDeliveryPaid,
};
