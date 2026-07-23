import Database from 'better-sqlite3';
import path from 'node:path';
import type {
  Animal,
  Delivery,
  FeedInventory,
  HealthEvent,
  Milking,
  Vendor,
} from '@dairy/shared';

// dairy.db lives next to the server package root (one level up from src once
// running via tsx, this resolves to server/dairy.db).
export const DB_PATH = path.join(__dirname, '..', 'dairy.db');

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export const SCHEMA = `
CREATE TABLE animals (
  id            TEXT PRIMARY KEY,
  tag           TEXT NOT NULL,
  name          TEXT,
  species       TEXT NOT NULL,
  breed         TEXT,
  status        TEXT NOT NULL,
  date_of_birth TEXT,
  group_name    TEXT
);

CREATE TABLE milkings (
  id           TEXT PRIMARY KEY,
  animal_id    TEXT NOT NULL REFERENCES animals(id),
  date         TEXT NOT NULL,
  session      TEXT NOT NULL,
  yield_litres REAL NOT NULL
);
CREATE INDEX idx_milkings_date ON milkings(date);
CREATE INDEX idx_milkings_animal ON milkings(animal_id);

CREATE TABLE feed_inventory (
  id                   TEXT PRIMARY KEY,
  feed_type            TEXT NOT NULL,
  quantity_kg          REAL NOT NULL,
  daily_consumption_kg REAL NOT NULL,
  reorder_threshold_kg REAL NOT NULL
);

CREATE TABLE health_events (
  id            TEXT PRIMARY KEY,
  animal_id     TEXT NOT NULL REFERENCES animals(id),
  date          TEXT NOT NULL,
  type          TEXT NOT NULL,
  notes         TEXT,
  next_due_date TEXT
);

-- Vendor / sales domain (Cycle 2 multi-agent; see docs/MULTI_AGENT.md).
-- deliveries and milkings are deliberately NOT linked by a foreign key: they
-- belong to different agents' domains and are only ever joined read-only, by
-- the reconciliation tool get_yield_vs_deliveries.
CREATE TABLE vendors (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  contact         TEXT,
  price_per_litre REAL NOT NULL,
  status          TEXT NOT NULL
);

CREATE TABLE deliveries (
  id              TEXT PRIMARY KEY,
  vendor_id       TEXT NOT NULL REFERENCES vendors(id),
  date            TEXT NOT NULL,
  litres          REAL NOT NULL,
  price_per_litre REAL NOT NULL,
  paid            INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_deliveries_date ON deliveries(date);
CREATE INDEX idx_deliveries_vendor ON deliveries(vendor_id);
`;

/** Drop everything and recreate the schema. Used by the seed script. */
export function resetSchema(): void {
  db.exec(`
    DROP TABLE IF EXISTS deliveries;
    DROP TABLE IF EXISTS vendors;
    DROP TABLE IF EXISTS milkings;
    DROP TABLE IF EXISTS health_events;
    DROP TABLE IF EXISTS feed_inventory;
    DROP TABLE IF EXISTS animals;
  `);
  db.exec(SCHEMA);
}

/** True once the DB has been seeded (used by the unseeded-DB guard). */
export function isSeeded(): boolean {
  try {
    const row = db
      .prepare(`SELECT COUNT(*) AS n FROM animals`)
      .get() as { n: number };
    return row.n > 0;
  } catch {
    // animals table doesn't exist yet
    return false;
  }
}

// ---------------------------------------------------------------------------
// Read helpers (synchronous, better-sqlite3)
// ---------------------------------------------------------------------------

export function getAnimalById(id: string): Animal | undefined {
  return db.prepare(`SELECT * FROM animals WHERE id = ?`).get(id) as
    | Animal
    | undefined;
}

export function animalExists(id: string): boolean {
  const row = db
    .prepare(`SELECT 1 AS x FROM animals WHERE id = ?`)
    .get(id) as { x: number } | undefined;
  return !!row;
}

export function groupExists(group: string): boolean {
  const row = db
    .prepare(`SELECT 1 AS x FROM animals WHERE group_name = ? LIMIT 1`)
    .get(group) as { x: number } | undefined;
  return !!row;
}

export function allAnimals(): Animal[] {
  return db.prepare(`SELECT * FROM animals ORDER BY tag`).all() as Animal[];
}

export function allFeed(): FeedInventory[] {
  return db
    .prepare(`SELECT * FROM feed_inventory ORDER BY feed_type`)
    .all() as FeedInventory[];
}

export function animalsInScope(scope: {
  animal_id?: string;
  group?: string;
}): Animal[] {
  if (scope.animal_id) {
    const a = getAnimalById(scope.animal_id);
    return a ? [a] : [];
  }
  if (scope.group) {
    return db
      .prepare(`SELECT * FROM animals WHERE group_name = ? ORDER BY tag`)
      .all(scope.group) as Animal[];
  }
  return [];
}

export function milkingsForAnimals(
  animalIds: string[],
  from: string,
  to: string,
): Milking[] {
  if (animalIds.length === 0) return [];
  const placeholders = animalIds.map(() => '?').join(',');
  return db
    .prepare(
      `SELECT * FROM milkings
       WHERE animal_id IN (${placeholders})
         AND date >= ? AND date <= ?
       ORDER BY date ASC`,
    )
    .all(...animalIds, from, to) as Milking[];
}

export function healthEventsForAnimal(animalId: string): HealthEvent[] {
  return db
    .prepare(
      `SELECT * FROM health_events WHERE animal_id = ? ORDER BY date DESC`,
    )
    .all(animalId) as HealthEvent[];
}

// ---------------------------------------------------------------------------
// Vendor / sales read helpers (Cycle 2). deliveries.paid is stored as 0/1 in
// SQLite; toDelivery() normalizes it to the boolean the Delivery type expects.
// ---------------------------------------------------------------------------

type DeliveryRow = Omit<Delivery, 'paid'> & { paid: number };

function toDelivery(row: DeliveryRow): Delivery {
  return { ...row, paid: !!row.paid };
}

export function getVendorById(id: string): Vendor | undefined {
  return db.prepare(`SELECT * FROM vendors WHERE id = ?`).get(id) as
    | Vendor
    | undefined;
}

export function vendorExists(id: string): boolean {
  const row = db
    .prepare(`SELECT 1 AS x FROM vendors WHERE id = ?`)
    .get(id) as { x: number } | undefined;
  return !!row;
}

export function allVendors(): Vendor[] {
  return db.prepare(`SELECT * FROM vendors ORDER BY name`).all() as Vendor[];
}

export function deliveryExists(id: string): boolean {
  const row = db
    .prepare(`SELECT 1 AS x FROM deliveries WHERE id = ?`)
    .get(id) as { x: number } | undefined;
  return !!row;
}

export function getDeliveryById(id: string): Delivery | undefined {
  const row = db.prepare(`SELECT * FROM deliveries WHERE id = ?`).get(id) as
    | DeliveryRow
    | undefined;
  return row ? toDelivery(row) : undefined;
}

/** Deliveries for one vendor (or all vendors when vendorId is undefined),
 * bounded to an inclusive date range. */
export function deliveriesInScope(scope: {
  vendorId?: string;
  from: string;
  to: string;
}): Delivery[] {
  const clauses = ['date >= ?', 'date <= ?'];
  const params: unknown[] = [scope.from, scope.to];
  if (scope.vendorId) {
    clauses.push('vendor_id = ?');
    params.push(scope.vendorId);
  }
  const rows = db
    .prepare(
      `SELECT * FROM deliveries WHERE ${clauses.join(' AND ')} ORDER BY date ASC`,
    )
    .all(...params) as DeliveryRow[];
  return rows.map(toDelivery);
}

/** All deliveries for one vendor, newest first (used by get_vendor detail). */
export function deliveriesForVendor(vendorId: string): Delivery[] {
  const rows = db
    .prepare(`SELECT * FROM deliveries WHERE vendor_id = ? ORDER BY date DESC`)
    .all(vendorId) as DeliveryRow[];
  return rows.map(toDelivery);
}

// ---------------------------------------------------------------------------
// Reconciliation (Cycle 2). The one place milkings and deliveries are joined --
// read-only, by summing each side over a date range. No FK between them.
// ---------------------------------------------------------------------------

/** Total litres milked across all animals over an inclusive date range. */
export function sumMilkYield(from: string, to: string): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(yield_litres), 0) AS s FROM milkings WHERE date >= ? AND date <= ?`,
    )
    .get(from, to) as { s: number };
  return row.s;
}

/** Total litres delivered to all vendors over an inclusive date range. */
export function sumDeliveredLitres(from: string, to: string): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(litres), 0) AS s FROM deliveries WHERE date >= ? AND date <= ?`,
    )
    .get(from, to) as { s: number };
  return row.s;
}
