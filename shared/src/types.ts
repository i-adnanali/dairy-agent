// Single source of truth for domain, DB-row, tool, and API types.
// Imported by both `server` and `web`.

// ---------------------------------------------------------------------------
// Domain / DB row types (mirror the SQLite schema in server/src/db.ts)
// ---------------------------------------------------------------------------

export type Species = 'buffalo' | 'cow';
export type AnimalStatus = 'lactating' | 'dry' | 'pregnant' | 'calf';
export type MilkingSession = 'morning' | 'evening';
export type HealthEventType = 'vaccination' | 'vet_visit' | 'treatment' | 'breeding';
export type Interval = 'day' | 'week' | 'month';

export interface Animal {
  id: string;
  tag: string;
  name: string | null;
  species: Species;
  breed: string | null;
  status: AnimalStatus;
  date_of_birth: string | null;
  group_name: string | null;
}

export interface Milking {
  id: string;
  animal_id: string;
  date: string;
  session: MilkingSession;
  yield_litres: number;
}

export interface FeedInventory {
  id: string;
  feed_type: string;
  quantity_kg: number;
  daily_consumption_kg: number;
  reorder_threshold_kg: number;
}

export interface HealthEvent {
  id: string;
  animal_id: string;
  date: string;
  type: HealthEventType;
  notes: string | null;
  next_due_date: string | null;
}

// ---------------------------------------------------------------------------
// Tool plumbing
// ---------------------------------------------------------------------------

/** What a read-tool executor returns: a small digest for the model, plus an
 * optional full dataset that goes straight to the client and never to the model. */
export interface ReadToolResult {
  modelDigest: unknown;
  dataset?: Dataset;
}

/** Structured tool errors -- "wrong cheaply": the model can read & retry. */
export interface ToolError {
  error: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// API contract (server <-> client)
// ---------------------------------------------------------------------------

export type Approval = { toolUseId: string; approved: boolean };

export type PendingWrite = {
  toolUseId: string;
  toolName: string;
  summary: string; // one-line human summary
  details: { label: string; value: string }[]; // card rows
  rows?: { tag: string; name?: string; value: string }[]; // optional table (log_milking)
};

export type DatasetPoint = {
  periodStart: string;
  totalLitres: number;
  avgPerAnimal: number;
};

export type Dataset = {
  datasetId: string;
  kind: 'timeseries';
  scopeLabel: string; // e.g. "Kundi group"
  interval: Interval;
  points: DatasetPoint[];
};

export type ToolCallView = {
  toolUseId: string;
  name: string;
  status: 'done' | 'error';
  argSummary: string;
};

export type ChatRender = {
  assistantText: string; // markdown
  toolCalls: ToolCallView[];
  pendingWrites?: PendingWrite[]; // present => awaiting approval
};

export type ChatResponse = {
  messages: AnthropicMessage[]; // opaque -- client stores and resends next turn
  render: ChatRender;
  datasets: Dataset[]; // render as charts
  done: boolean; // false => awaiting approval (or capped)
};

export type ChatRequest = {
  messages: AnthropicMessage[];
  approvals?: Approval[];
};

// ---------------------------------------------------------------------------
// Minimal Anthropic message shapes (kept opaque to the client, but typed
// enough for the loop to assemble tool_use / tool_result blocks).
// ---------------------------------------------------------------------------

export type TextBlock = { type: 'text'; text: string };

export type ToolUseBlock = {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type ToolResultBlock = {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export type AnthropicMessage = {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
};
