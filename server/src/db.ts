import Database from 'better-sqlite3';
import path from 'node:path';
import type {
  Animal,
  FeedInventory,
  HealthEvent,
  Milking,
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
`;

/** Drop everything and recreate the schema. Used by the seed script. */
export function resetSchema(): void {
  db.exec(`
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
