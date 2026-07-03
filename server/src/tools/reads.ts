import type { ReadToolResult, ToolError } from '@dairy/shared';
import {
  allAnimals,
  allFeed,
  animalsInScope,
  db,
  getAnimalById,
  healthEventsForAnimal,
  milkingsForAnimals,
} from '../db';
import { shapeMilkYield } from './shaper';

type Args = Record<string, unknown>;

function isToolError(x: unknown): x is ToolError {
  return !!x && typeof x === 'object' && 'error' in (x as object);
}

// --- list_animals ----------------------------------------------------------
export function listAnimals(args: Args): ReadToolResult {
  const group = typeof args.group === 'string' ? args.group : undefined;
  const status = typeof args.status === 'string' ? args.status : undefined;

  const clauses: string[] = [];
  const params: unknown[] = [];
  if (group) {
    clauses.push('group_name = ?');
    params.push(group);
  }
  if (status) {
    clauses.push('status = ?');
    params.push(status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(`SELECT id, tag, name, species, status, group_name FROM animals ${where} ORDER BY tag`)
    .all(...params);

  return { modelDigest: { count: rows.length, animals: rows } };
}

// --- get_animal -------------------------------------------------------------
export function getAnimal(args: Args): ReadToolResult {
  const animalId = String(args.animal_id ?? '');
  const animal = getAnimalById(animalId);
  if (!animal) {
    return { modelDigest: { error: 'unknown_animal', animal_id: animalId } satisfies ToolError };
  }

  // 30-day yield summary.
  const to = new Date();
  to.setHours(12, 0, 0, 0);
  const from = new Date(to);
  from.setDate(from.getDate() - 29);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const milkings = milkingsForAnimals([animalId], iso(from), iso(to));

  const totalLitres = milkings.reduce((s, m) => s + m.yield_litres, 0);
  const days = new Set(milkings.map((m) => m.date)).size;
  const recentAvgDailyLitres = days > 0 ? Math.round((totalLitres / days) * 100) / 100 : 0;
  const lastMilkingDate = milkings.length
    ? milkings.reduce((a, b) => (a.date > b.date ? a : b)).date
    : null;

  const events = healthEventsForAnimal(animalId);
  const today = iso(new Date());
  const openHealthEvents = events.filter((e) => e.next_due_date && e.next_due_date >= today).length;

  return {
    modelDigest: {
      animal,
      recentAvgDailyLitres,
      lastMilkingDate,
      openHealthEvents,
    },
  };
}

// --- get_milk_yield (the data-shaping showcase) -----------------------------
export function getMilkYield(args: Args): ReadToolResult {
  const animal_id = typeof args.animal_id === 'string' ? args.animal_id : undefined;
  const group = typeof args.group === 'string' ? args.group : undefined;
  const from = String(args.from ?? '');
  const to = String(args.to ?? '');
  const interval = (typeof args.interval === 'string' ? args.interval : 'day') as
    | 'day'
    | 'week'
    | 'month';

  if (!animal_id && !group) {
    return {
      modelDigest: {
        error: 'missing_scope',
        message: 'Either animal_id or group must be provided.',
      } satisfies ToolError,
    };
  }
  if (!from || !to) {
    return {
      modelDigest: {
        error: 'missing_range',
        message: 'Both from and to (YYYY-MM-DD) are required.',
      } satisfies ToolError,
    };
  }

  const animals = animalsInScope({ animal_id, group });
  if (animals.length === 0) {
    return {
      modelDigest: {
        error: animal_id ? 'unknown_animal' : 'unknown_group',
        ...(animal_id ? { animal_id } : { group }),
      } satisfies ToolError,
    };
  }

  const ids = animals.map((a) => a.id);
  const rows = milkingsForAnimals(ids, from, to);
  const scopeLabel = group ? `${group} group` : `${animals[0].tag}${animals[0].name ? ' ' + animals[0].name : ''}`;

  const { digest, dataset } = shapeMilkYield({
    rows,
    animalCount: animals.length,
    scopeLabel,
    from,
    to,
    requestedInterval: interval,
  });

  return { modelDigest: digest, dataset };
}

// --- search_animals (bounded top-K, designed for scale) ---------------------
export function searchAnimals(args: Args): ReadToolResult {
  const query = String(args.query ?? '').trim().toLowerCase();
  if (!query) {
    return { modelDigest: { error: 'missing_query', message: 'query is required.' } satisfies ToolError };
  }
  const MAX_K = 8;
  const animals = allAnimals();

  const scored = animals
    .map((a) => {
      const hay = [a.tag, a.name ?? '', a.breed ?? '', a.group_name ?? '']
        .join(' ')
        .toLowerCase();
      let score = 0;
      if (hay.includes(query)) score = 2;
      // token-ish partial match
      else if (query.split(/\s+/).some((tok) => tok && hay.includes(tok))) score = 1;
      return { a, score };
    })
    .filter((s) => s.score > 0)
    .sort((x, y) => y.score - x.score);

  const tooMany = scored.length > MAX_K;
  const top = scored.slice(0, MAX_K).map((s) => ({
    id: s.a.id,
    tag: s.a.tag,
    name: s.a.name,
    breed: s.a.breed,
    status: s.a.status,
    group_name: s.a.group_name,
  }));

  return { modelDigest: { count: top.length, tooMany, totalMatches: scored.length, animals: top } };
}

// --- get_feed_status --------------------------------------------------------
export function getFeedStatus(_args: Args): ReadToolResult {
  const feed = allFeed();
  const items = feed.map((f) => {
    const daysRemaining =
      f.daily_consumption_kg > 0
        ? Math.round((f.quantity_kg / f.daily_consumption_kg) * 10) / 10
        : null;
    return {
      feed_type: f.feed_type,
      quantity_kg: f.quantity_kg,
      daily_consumption_kg: f.daily_consumption_kg,
      reorder_threshold_kg: f.reorder_threshold_kg,
      belowThreshold: f.quantity_kg < f.reorder_threshold_kg,
      daysRemaining,
    };
  });
  return { modelDigest: { items, anyBelowThreshold: items.some((i) => i.belowThreshold) } };
}

// --- get_health_events ------------------------------------------------------
export function getHealthEvents(args: Args): ReadToolResult {
  const animal_id = typeof args.animal_id === 'string' ? args.animal_id : undefined;
  const dueWithin =
    typeof args.due_within_days === 'number' ? args.due_within_days : undefined;

  if (animal_id && !getAnimalById(animal_id)) {
    return { modelDigest: { error: 'unknown_animal', animal_id } satisfies ToolError };
  }

  const clauses: string[] = [];
  const params: unknown[] = [];
  if (animal_id) {
    clauses.push('he.animal_id = ?');
    params.push(animal_id);
  }
  if (dueWithin !== undefined) {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const until = new Date(today);
    until.setDate(until.getDate() + dueWithin);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    clauses.push('he.next_due_date IS NOT NULL AND he.next_due_date >= ? AND he.next_due_date <= ?');
    params.push(iso(today), iso(until));
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const rows = db
    .prepare(
      `SELECT he.id, he.animal_id, a.tag, a.name, he.date, he.type, he.notes, he.next_due_date
       FROM health_events he
       JOIN animals a ON a.id = he.animal_id
       ${where}
       ORDER BY COALESCE(he.next_due_date, he.date) ASC`,
    )
    .all(...params);

  return { modelDigest: { count: rows.length, events: rows } };
}

export const READ_EXECUTORS: Record<string, (args: Args) => ReadToolResult> = {
  list_animals: listAnimals,
  get_animal: getAnimal,
  get_milk_yield: getMilkYield,
  search_animals: searchAnimals,
  get_feed_status: getFeedStatus,
  get_health_events: getHealthEvents,
};

export { isToolError };
