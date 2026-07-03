import { randomUUID } from 'node:crypto';
import type { PendingWrite } from '@dairy/shared';
import { animalExists, db, getAnimalById } from '../db';

type Args = Record<string, unknown>;

export interface WriteExecutor {
  execute: (args: Args) => unknown;
  buildCard: (toolUseId: string, args: Args) => PendingWrite;
}

function tagLabel(animalId: string): string {
  const a = getAnimalById(animalId);
  if (!a) return animalId;
  return a.name ? `${a.tag} (${a.name})` : a.tag;
}

// --- log_milking ------------------------------------------------------------
interface MilkEntry {
  animal_id: string;
  yield_litres: number;
}

function entriesOf(args: Args): MilkEntry[] {
  const raw = Array.isArray(args.entries) ? args.entries : [];
  return raw.map((e) => ({
    animal_id: String((e as Args).animal_id ?? ''),
    yield_litres: Number((e as Args).yield_litres ?? 0),
  }));
}

const logMilking: WriteExecutor = {
  execute(args) {
    const date = String(args.date);
    const session = String(args.session);
    const entries = entriesOf(args);
    const insert = db.prepare(
      `INSERT INTO milkings (id, animal_id, date, session, yield_litres)
       VALUES (@id, @animal_id, @date, @session, @yield_litres)`,
    );
    const tx = db.transaction(() => {
      for (const e of entries) {
        insert.run({
          id: `milking_${randomUUID().slice(0, 8)}`,
          animal_id: e.animal_id,
          date,
          session,
          yield_litres: e.yield_litres,
        });
      }
    });
    tx();
    const total = entries.reduce((s, e) => s + e.yield_litres, 0);
    return { inserted: entries.length, totalLitres: Math.round(total * 100) / 100, date, session };
  },
  buildCard(toolUseId, args) {
    const date = String(args.date);
    const session = String(args.session);
    const entries = entriesOf(args);
    const total = entries.reduce((s, e) => s + e.yield_litres, 0);
    return {
      toolUseId,
      toolName: 'log_milking',
      summary: `Log ${session} milking for ${entries.length} animal(s) on ${date}, total ${Math.round(total * 100) / 100} L`,
      details: [
        { label: 'Date', value: date },
        { label: 'Session', value: session },
        { label: 'Animals', value: String(entries.length) },
        { label: 'Total', value: `${Math.round(total * 100) / 100} L` },
      ],
      rows: entries.map((e) => {
        const a = getAnimalById(e.animal_id);
        return {
          tag: a?.tag ?? e.animal_id,
          name: a?.name ?? undefined,
          value: `${e.yield_litres} L`,
        };
      }),
    };
  },
};

// --- add_animal -------------------------------------------------------------
const addAnimal: WriteExecutor = {
  execute(args) {
    const id = `animal_${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO animals (id, tag, name, species, breed, status, date_of_birth, group_name)
       VALUES (@id, @tag, @name, @species, @breed, @status, @date_of_birth, @group_name)`,
    ).run({
      id,
      tag: String(args.tag),
      name: args.name != null ? String(args.name) : null,
      species: String(args.species),
      breed: args.breed != null ? String(args.breed) : null,
      status: String(args.status),
      date_of_birth: args.date_of_birth != null ? String(args.date_of_birth) : null,
      group_name: args.group_name != null ? String(args.group_name) : null,
    });
    return { created: true, id, tag: String(args.tag) };
  },
  buildCard(toolUseId, args) {
    return {
      toolUseId,
      toolName: 'add_animal',
      summary: `Add ${String(args.species)} "${String(args.tag)}"${args.name ? ` (${String(args.name)})` : ''} as ${String(args.status)}`,
      details: [
        { label: 'Tag', value: String(args.tag) },
        { label: 'Name', value: args.name ? String(args.name) : '-' },
        { label: 'Species', value: String(args.species) },
        { label: 'Breed', value: args.breed ? String(args.breed) : '-' },
        { label: 'Status', value: String(args.status) },
        { label: 'Date of birth', value: args.date_of_birth ? String(args.date_of_birth) : '-' },
        { label: 'Group', value: args.group_name ? String(args.group_name) : '-' },
      ],
    };
  },
};

// --- log_health_event -------------------------------------------------------
const logHealthEvent: WriteExecutor = {
  execute(args) {
    const id = `health_${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO health_events (id, animal_id, date, type, notes, next_due_date)
       VALUES (@id, @animal_id, @date, @type, @notes, @next_due_date)`,
    ).run({
      id,
      animal_id: String(args.animal_id),
      date: String(args.date),
      type: String(args.type),
      notes: args.notes != null ? String(args.notes) : null,
      next_due_date: args.next_due_date != null ? String(args.next_due_date) : null,
    });
    return { created: true, id };
  },
  buildCard(toolUseId, args) {
    return {
      toolUseId,
      toolName: 'log_health_event',
      summary: `Log ${String(args.type)} for ${tagLabel(String(args.animal_id))} on ${String(args.date)}`,
      details: [
        { label: 'Animal', value: tagLabel(String(args.animal_id)) },
        { label: 'Date', value: String(args.date) },
        { label: 'Type', value: String(args.type) },
        { label: 'Notes', value: args.notes ? String(args.notes) : '-' },
        { label: 'Next due', value: args.next_due_date ? String(args.next_due_date) : '-' },
      ],
    };
  },
};

// --- update_feed_inventory --------------------------------------------------
const updateFeedInventory: WriteExecutor = {
  execute(args) {
    const feedType = String(args.feed_type);
    const qty = Number(args.quantity_kg);
    const info = db
      .prepare(`UPDATE feed_inventory SET quantity_kg = ? WHERE feed_type = ?`)
      .run(qty, feedType);
    return { updated: info.changes, feed_type: feedType, quantity_kg: qty };
  },
  buildCard(toolUseId, args) {
    return {
      toolUseId,
      toolName: 'update_feed_inventory',
      summary: `Set ${String(args.feed_type)} on-hand to ${Number(args.quantity_kg)} kg`,
      details: [
        { label: 'Feed type', value: String(args.feed_type) },
        { label: 'New quantity', value: `${Number(args.quantity_kg)} kg` },
      ],
    };
  },
};

// --- schedule_health_event --------------------------------------------------
const scheduleHealthEvent: WriteExecutor = {
  execute(args) {
    const id = `health_${randomUUID().slice(0, 8)}`;
    const today = new Date().toISOString().slice(0, 10);
    db.prepare(
      `INSERT INTO health_events (id, animal_id, date, type, notes, next_due_date)
       VALUES (@id, @animal_id, @date, @type, @notes, @next_due_date)`,
    ).run({
      id,
      animal_id: String(args.animal_id),
      date: today,
      type: String(args.type),
      notes: args.notes != null ? String(args.notes) : null,
      next_due_date: String(args.next_due_date),
    });
    return { created: true, id, next_due_date: String(args.next_due_date) };
  },
  buildCard(toolUseId, args) {
    return {
      toolUseId,
      toolName: 'schedule_health_event',
      summary: `Schedule ${String(args.type)} for ${tagLabel(String(args.animal_id))} on ${String(args.next_due_date)}`,
      details: [
        { label: 'Animal', value: tagLabel(String(args.animal_id)) },
        { label: 'Type', value: String(args.type) },
        { label: 'Due date', value: String(args.next_due_date) },
        { label: 'Notes', value: args.notes ? String(args.notes) : '-' },
      ],
    };
  },
};

export const WRITE_EXECUTORS: Record<string, WriteExecutor> = {
  log_milking: logMilking,
  add_animal: addAnimal,
  log_health_event: logHealthEvent,
  update_feed_inventory: updateFeedInventory,
  schedule_health_event: scheduleHealthEvent,
};

/** Re-export so the guard module can confirm existence consistently. */
export { animalExists };
