import { db, resetSchema } from './db';
import type {
  AnimalStatus,
  HealthEventType,
  Species,
} from '@dairy/shared';

// Deterministic RNG (mulberry32) so every seed run produces identical data.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(20260628);
const rand = (min: number, max: number) => min + rng() * (max - min);

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return isoDate(d);
}

function daysFromNow(n: number): string {
  return daysAgo(-n);
}

interface SeedAnimal {
  id: string;
  tag: string;
  name: string | null;
  species: Species;
  breed: string;
  status: AnimalStatus;
  date_of_birth: string;
  group_name: string;
}

// 14 animals: 8 Kundi, 6 Nili-Ravi. Animals are identified by breed + tag; no per-animal names.
const ANIMALS: SeedAnimal[] = [
  // --- Kundi group (8) ---
  { id: 'animal_001', tag: 'B-001', name: null, species: 'buffalo', breed: 'Kundi', status: 'lactating', date_of_birth: '2020-03-14', group_name: 'Kundi' },
  { id: 'animal_002', tag: 'B-002', name: null, species: 'buffalo', breed: 'Kundi', status: 'lactating', date_of_birth: '2019-11-02', group_name: 'Kundi' },
  { id: 'animal_003', tag: 'B-003', name: null, species: 'buffalo', breed: 'Kundi', status: 'lactating', date_of_birth: '2021-01-20', group_name: 'Kundi' },
  { id: 'animal_004', tag: 'B-004', name: null, species: 'buffalo', breed: 'Kundi', status: 'lactating', date_of_birth: '2020-07-08', group_name: 'Kundi' },
  { id: 'animal_005', tag: 'B-005', name: null, species: 'buffalo', breed: 'Kundi', status: 'lactating', date_of_birth: '2018-09-30', group_name: 'Kundi' },
  { id: 'animal_006', tag: 'B-006', name: null, species: 'buffalo', breed: 'Kundi', status: 'lactating', date_of_birth: '2021-05-12', group_name: 'Kundi' },
  { id: 'animal_007', tag: 'B-007', name: null, species: 'buffalo', breed: 'Kundi', status: 'dry', date_of_birth: '2017-12-01', group_name: 'Kundi' },
  { id: 'animal_008', tag: 'B-008', name: null, species: 'buffalo', breed: 'Kundi', status: 'pregnant', date_of_birth: '2019-04-22', group_name: 'Kundi' },
  // --- Nili-Ravi group (6) ---
  { id: 'animal_009', tag: 'B-009', name: null, species: 'buffalo', breed: 'Nili-Ravi', status: 'lactating', date_of_birth: '2020-02-18', group_name: 'Nili-Ravi' },
  { id: 'animal_010', tag: 'B-010', name: null, species: 'buffalo', breed: 'Nili-Ravi', status: 'lactating', date_of_birth: '2019-08-09', group_name: 'Nili-Ravi' },
  { id: 'animal_011', tag: 'B-011', name: null, species: 'buffalo', breed: 'Nili-Ravi', status: 'lactating', date_of_birth: '2021-03-03', group_name: 'Nili-Ravi' },
  { id: 'animal_012', tag: 'B-012', name: null, species: 'buffalo', breed: 'Nili-Ravi', status: 'pregnant', date_of_birth: '2020-10-27', group_name: 'Nili-Ravi' },
  { id: 'animal_013', tag: 'B-013', name: null, species: 'buffalo', breed: 'Nili-Ravi', status: 'calf', date_of_birth: '2025-12-15', group_name: 'Nili-Ravi' },
  { id: 'animal_014', tag: 'B-014', name: null, species: 'buffalo', breed: 'Nili-Ravi', status: 'dry', date_of_birth: '2018-06-11', group_name: 'Nili-Ravi' },
];

function seed(): void {
  resetSchema();

  const insertAnimal = db.prepare(
    `INSERT INTO animals (id, tag, name, species, breed, status, date_of_birth, group_name)
     VALUES (@id, @tag, @name, @species, @breed, @status, @date_of_birth, @group_name)`,
  );
  const insertMilking = db.prepare(
    `INSERT INTO milkings (id, animal_id, date, session, yield_litres)
     VALUES (@id, @animal_id, @date, @session, @yield_litres)`,
  );
  const insertFeed = db.prepare(
    `INSERT INTO feed_inventory (id, feed_type, quantity_kg, daily_consumption_kg, reorder_threshold_kg)
     VALUES (@id, @feed_type, @quantity_kg, @daily_consumption_kg, @reorder_threshold_kg)`,
  );
  const insertHealth = db.prepare(
    `INSERT INTO health_events (id, animal_id, date, type, notes, next_due_date)
     VALUES (@id, @animal_id, @date, @type, @notes, @next_due_date)`,
  );

  const run = db.transaction(() => {
    for (const a of ANIMALS) insertAnimal.run(a);

    // 90 days of milkings (morning + evening) for each lactating animal.
    const DAYS = 90;
    let milkSeq = 0;
    for (const a of ANIMALS) {
      if (a.status !== 'lactating') continue;
      const base = rand(4.0, 7.0); // per-session base yield for this animal
      for (let dayIndex = 0; dayIndex < DAYS; dayIndex++) {
        // dayIndex 0 is the oldest, DAYS-1 is today => slow upward trend.
        const date = daysAgo(DAYS - 1 - dayIndex);
        const trend = 1 + 0.0015 * dayIndex;
        for (const session of ['morning', 'evening'] as const) {
          const noise = rand(-0.6, 0.6);
          const yieldL = Math.max(0, base * trend + noise);
          milkSeq += 1;
          insertMilking.run({
            id: `milking_${String(milkSeq).padStart(5, '0')}`,
            animal_id: a.id,
            date,
            session,
            yield_litres: Math.round(yieldL * 100) / 100,
          });
        }
      }
    }

    // Feed: 4 rows, one (concentrate) below its reorder threshold.
    const feed = [
      { id: 'feed_001', feed_type: 'green fodder', quantity_kg: 1200, daily_consumption_kg: 180, reorder_threshold_kg: 400 },
      { id: 'feed_002', feed_type: 'silage', quantity_kg: 900, daily_consumption_kg: 120, reorder_threshold_kg: 300 },
      { id: 'feed_003', feed_type: 'wheat bran', quantity_kg: 350, daily_consumption_kg: 40, reorder_threshold_kg: 150 },
      { id: 'feed_004', feed_type: 'concentrate', quantity_kg: 80, daily_consumption_kg: 35, reorder_threshold_kg: 100 },
    ];
    for (const f of feed) insertFeed.run(f);

    // Health events: ~6, with 2 due within the next 14 days.
    const health = [
      { id: 'health_001', animal_id: 'animal_001', date: daysAgo(40), type: 'vaccination' as HealthEventType, notes: 'FMD vaccination, annual booster.', next_due_date: daysFromNow(7) },
      { id: 'health_002', animal_id: 'animal_008', date: daysAgo(20), type: 'vet_visit' as HealthEventType, notes: 'Pregnancy check, ~6 months along.', next_due_date: daysFromNow(12) },
      { id: 'health_003', animal_id: 'animal_003', date: daysAgo(12), type: 'treatment' as HealthEventType, notes: 'Treated for mild mastitis, course completed.', next_due_date: null },
      { id: 'health_004', animal_id: 'animal_005', date: daysAgo(60), type: 'breeding' as HealthEventType, notes: 'Artificial insemination.', next_due_date: null },
      { id: 'health_005', animal_id: 'animal_010', date: daysAgo(95), type: 'vaccination' as HealthEventType, notes: 'HS vaccination.', next_due_date: daysAgo(5) },
      { id: 'health_006', animal_id: 'animal_002', date: daysAgo(8), type: 'vet_visit' as HealthEventType, notes: 'Routine hoof trimming.', next_due_date: null },
    ];
    for (const h of health) insertHealth.run(h);
  });

  run();

  const counts = {
    animals: (db.prepare(`SELECT COUNT(*) AS n FROM animals`).get() as { n: number }).n,
    milkings: (db.prepare(`SELECT COUNT(*) AS n FROM milkings`).get() as { n: number }).n,
    feed: (db.prepare(`SELECT COUNT(*) AS n FROM feed_inventory`).get() as { n: number }).n,
    health: (db.prepare(`SELECT COUNT(*) AS n FROM health_events`).get() as { n: number }).n,
  };
  console.log('Seeded dairy.db:', counts);
}

seed();
