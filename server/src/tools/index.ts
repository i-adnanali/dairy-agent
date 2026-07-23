import type { ToolError } from '@dairy/shared';
import type { Agent } from '../agent/dispatch';
import { animalExists, deliveryExists, groupExists, vendorExists } from '../db';
import { READ_EXECUTORS as DAIRY_READ_EXECUTORS } from './reads';
import { WRITE_EXECUTORS as DAIRY_WRITE_EXECUTORS } from './writes';
import { VENDOR_READ_EXECUTORS } from './vendorReads';
import { VENDOR_WRITE_EXECUTORS } from './vendorWrites';
import { RECONCILE_EXECUTORS, RECONCILE_TOOLS } from './reconcile';

export interface ToolSchema {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export const READ_TOOLS: ToolSchema[] = [
  {
    name: 'list_animals',
    description:
      'List animals on the farm, optionally filtered by herd group and/or status. Returns a compact list (id, tag, name, species, status, group). Use this to enumerate animals or resolve which animals belong to a group.',
    input_schema: {
      type: 'object',
      properties: {
        group: { type: 'string', description: "Herd group, e.g. 'Kundi'" },
        status: { type: 'string', enum: ['lactating', 'dry', 'pregnant', 'calf'] },
      },
    },
  },
  {
    name: 'get_animal',
    description:
      'Get full detail for a single animal by id, including a 30-day yield summary (recent average daily litres, last milking date) and a count of open (future-dated) health events.',
    input_schema: {
      type: 'object',
      required: ['animal_id'],
      properties: { animal_id: { type: 'string' } },
    },
  },
  {
    name: 'get_milk_yield',
    description:
      "Milk yield over a date range for one animal or a whole group, bucketed by interval. Either animal_id or group MUST be provided. Returns summary statistics only (totals, mean, min/max, trend); the full time series is rendered as a chart for the user, so you do not receive every data point. Prefer coarser intervals for longer ranges (the system will coarsen day->week past ~90 days and ->month past a year, and tells you when it does). State which animal/group and interval you used.",
    input_schema: {
      type: 'object',
      required: ['from', 'to', 'interval'],
      properties: {
        animal_id: { type: 'string' },
        group: { type: 'string' },
        from: { type: 'string', description: 'ISO date YYYY-MM-DD' },
        to: { type: 'string', description: 'ISO date YYYY-MM-DD' },
        interval: { type: 'string', enum: ['day', 'week', 'month'] },
      },
    },
  },
  {
    name: 'search_animals',
    description:
      'Fuzzy-find animals by name, tag, breed, or group. Returns the top matches (max 8) with a tooMany flag when the result set was truncated. Use when you are not sure of an exact id or tag.',
    input_schema: {
      type: 'object',
      required: ['query'],
      properties: { query: { type: 'string' } },
    },
  },
  {
    name: 'get_feed_status',
    description:
      'Current feed inventory for every feed type, with a belowThreshold flag and daysRemaining (quantity / daily consumption). Use to answer questions about feed levels and reordering.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_health_events',
    description:
      'Health events, optionally for one animal and/or only those with a next_due_date within the next N days. Use to answer "what is due soon" and per-animal health history questions.',
    input_schema: {
      type: 'object',
      properties: {
        animal_id: { type: 'string' },
        due_within_days: { type: 'integer', minimum: 1 },
      },
    },
  },
];

export const WRITE_TOOLS: ToolSchema[] = [
  {
    name: 'log_milking',
    description:
      'Record a milking session for one or more animals. The system shows the user a confirmation card and will NOT write anything until they approve; do not ask "shall I?" in text -- just call with complete arguments. Provide the date, session, and one entry per animal with its yield in litres.',
    input_schema: {
      type: 'object',
      required: ['date', 'session', 'entries'],
      properties: {
        date: { type: 'string' },
        session: { type: 'string', enum: ['morning', 'evening'] },
        entries: {
          type: 'array',
          items: {
            type: 'object',
            required: ['animal_id', 'yield_litres'],
            properties: {
              animal_id: { type: 'string' },
              yield_litres: { type: 'number', minimum: 0, maximum: 40 },
            },
          },
        },
      },
    },
  },
  {
    name: 'add_animal',
    description:
      'Add a new animal to the herd. Confirmation-gated. Provide at least tag, species, and status.',
    input_schema: {
      type: 'object',
      required: ['tag', 'species', 'status'],
      properties: {
        tag: { type: 'string' },
        name: { type: 'string' },
        species: { type: 'string', enum: ['buffalo', 'cow'] },
        breed: { type: 'string' },
        status: { type: 'string', enum: ['lactating', 'dry', 'pregnant', 'calf'] },
        date_of_birth: { type: 'string' },
        group_name: { type: 'string' },
      },
    },
  },
  {
    name: 'log_health_event',
    description:
      'Record a health event (vaccination, vet_visit, treatment, breeding) that has occurred for an animal. Confirmation-gated. next_due_date is optional (set it for events that recur).',
    input_schema: {
      type: 'object',
      required: ['animal_id', 'date', 'type'],
      properties: {
        animal_id: { type: 'string' },
        date: { type: 'string' },
        type: { type: 'string', enum: ['vaccination', 'vet_visit', 'treatment', 'breeding'] },
        notes: { type: 'string' },
        next_due_date: { type: 'string' },
      },
    },
  },
  {
    name: 'update_feed_inventory',
    description:
      'Set the on-hand quantity (kg) for a feed type. Confirmation-gated. Use after a delivery or stock count.',
    input_schema: {
      type: 'object',
      required: ['feed_type', 'quantity_kg'],
      properties: {
        feed_type: { type: 'string' },
        quantity_kg: { type: 'number', minimum: 0 },
      },
    },
  },
  {
    name: 'schedule_health_event',
    description:
      'Schedule a future health event for an animal (sets next_due_date). Confirmation-gated. Use for upcoming vaccinations, vet visits, etc.',
    input_schema: {
      type: 'object',
      required: ['animal_id', 'type', 'next_due_date'],
      properties: {
        animal_id: { type: 'string' },
        type: { type: 'string', enum: ['vaccination', 'vet_visit', 'treatment', 'breeding'] },
        next_due_date: { type: 'string' },
        notes: { type: 'string' },
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Vendor / sales tools (Cycle 2 multi-agent; see docs/MULTI_AGENT.md). Kept in
// their own schema arrays so the dispatcher (Phase 03) can advertise the dairy
// set, the vendor set, or both to the model per turn.
// ---------------------------------------------------------------------------

export const VENDOR_READ_TOOLS: ToolSchema[] = [
  {
    name: 'list_vendors',
    description:
      'List milk vendors, optionally filtered by status. Returns a compact list (id, name, status, price_per_litre). Use to enumerate vendors or resolve which vendor a name refers to.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['active', 'inactive'] },
      },
    },
  },
  {
    name: 'get_vendor',
    description:
      'Get full detail for a single vendor by id: their outstanding balance (value of unpaid deliveries), delivery totals, last delivery date, and up to 10 most recent deliveries.',
    input_schema: {
      type: 'object',
      required: ['vendor_id'],
      properties: { vendor_id: { type: 'string' } },
    },
  },
  {
    name: 'get_deliveries',
    description:
      'Milk deliveries over a date range for one vendor or all vendors. Returns summary statistics (total litres, total value, unpaid value) plus a per-vendor breakdown. Provide vendor_id to scope to one vendor, or omit it for all.',
    input_schema: {
      type: 'object',
      required: ['from', 'to'],
      properties: {
        vendor_id: { type: 'string' },
        from: { type: 'string', description: 'ISO date YYYY-MM-DD' },
        to: { type: 'string', description: 'ISO date YYYY-MM-DD' },
      },
    },
  },
];

export const VENDOR_WRITE_TOOLS: ToolSchema[] = [
  {
    name: 'register_vendor',
    description:
      'Register a new milk vendor. Confirmation-gated. Provide at least name and price_per_litre; status defaults to active.',
    input_schema: {
      type: 'object',
      required: ['name', 'price_per_litre'],
      properties: {
        name: { type: 'string' },
        contact: { type: 'string' },
        price_per_litre: { type: 'number', minimum: 0 },
        status: { type: 'string', enum: ['active', 'inactive'] },
      },
    },
  },
  {
    name: 'record_delivery',
    description:
      'Record a milk delivery to one vendor. Confirmation-gated; the system shows a confirmation card and writes nothing until the user approves -- do not ask "shall I?" in text, just call with complete arguments. The price per litre is captured from the vendor automatically at delivery time. One vendor and one quantity per call.',
    input_schema: {
      type: 'object',
      required: ['vendor_id', 'date', 'litres'],
      properties: {
        vendor_id: { type: 'string' },
        date: { type: 'string', description: 'ISO date YYYY-MM-DD' },
        litres: { type: 'number', minimum: 0 },
      },
    },
  },
  {
    name: 'mark_delivery_paid',
    description:
      'Mark a single delivery as paid (settles it against the vendor balance). Confirmation-gated. Provide the delivery_id.',
    input_schema: {
      type: 'object',
      required: ['delivery_id'],
      properties: { delivery_id: { type: 'string' } },
    },
  },
];

// Re-export so the dispatcher (Phase 03) can offer reconciliation only for the
// `both` selection, since it's the one tool that legitimately needs both tables.
export { RECONCILE_TOOLS };

export const ALL_TOOLS: ToolSchema[] = [
  ...READ_TOOLS,
  ...WRITE_TOOLS,
  ...VENDOR_READ_TOOLS,
  ...VENDOR_WRITE_TOOLS,
  ...RECONCILE_TOOLS,
];

export const READ_TOOL_NAMES = new Set(
  [...READ_TOOLS, ...VENDOR_READ_TOOLS, ...RECONCILE_TOOLS].map((t) => t.name),
);
export const WRITE_TOOL_NAMES = new Set(
  [...WRITE_TOOLS, ...VENDOR_WRITE_TOOLS].map((t) => t.name),
);

/** Tool schemas offered to the model for a given dispatcher selection. The
 * reconciliation tool is offered only to `both`, since it's the one tool that
 * legitimately needs both domains' tables. */
export function toolsForAgent(agent: Agent): ToolSchema[] {
  if (agent === 'dairy') return [...READ_TOOLS, ...WRITE_TOOLS];
  if (agent === 'vendor') return [...VENDOR_READ_TOOLS, ...VENDOR_WRITE_TOOLS];
  return ALL_TOOLS;
}

/**
 * ID-integrity guard (spec 4.3): before executing ANY tool, validate that every
 * animal_id / group referenced in the args exists. On failure, returns a
 * structured ToolError so the model can self-correct -- the tool never runs.
 */
export function guardIds(args: Record<string, unknown>): ToolError | null {
  if (typeof args.animal_id === 'string' && args.animal_id) {
    if (!animalExists(args.animal_id)) {
      return { error: 'unknown_animal', animal_id: args.animal_id };
    }
  }
  if (typeof args.group === 'string' && args.group) {
    if (!groupExists(args.group)) {
      return { error: 'unknown_group', group: args.group };
    }
  }
  if (typeof args.vendor_id === 'string' && args.vendor_id) {
    if (!vendorExists(args.vendor_id)) {
      return { error: 'unknown_vendor', vendor_id: args.vendor_id };
    }
  }
  if (typeof args.delivery_id === 'string' && args.delivery_id) {
    if (!deliveryExists(args.delivery_id)) {
      return { error: 'unknown_delivery', delivery_id: args.delivery_id };
    }
  }
  if (Array.isArray(args.entries)) {
    for (const e of args.entries) {
      const aid = (e as Record<string, unknown>)?.animal_id;
      if (typeof aid === 'string' && aid && !animalExists(aid)) {
        return { error: 'unknown_animal', animal_id: aid };
      }
    }
  }
  return null;
}

/** Executor maps merge the dairy and vendor tool sets. Which schemas the model
 * is *offered* is decided per turn by the dispatcher; execution is looked up by
 * tool name against these merged maps regardless. */
export const READ_EXECUTORS = {
  ...DAIRY_READ_EXECUTORS,
  ...VENDOR_READ_EXECUTORS,
  ...RECONCILE_EXECUTORS,
};
export const WRITE_EXECUTORS = { ...DAIRY_WRITE_EXECUTORS, ...VENDOR_WRITE_EXECUTORS };
