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

// --- Vendor / sales domain (Cycle 2 multi-agent; see docs/MULTI_AGENT.md) ----

export type VendorStatus = 'active' | 'inactive';

export interface Vendor {
  id: string;
  name: string;
  contact: string | null;
  price_per_litre: number;
  status: VendorStatus;
}

export interface Delivery {
  id: string;
  vendor_id: string;
  date: string;
  litres: number;
  price_per_litre: number; // captured at delivery time; vendor price may change later
  paid: boolean;
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
// AG-UI streaming contract (server <-> Angular client, POST /api/agent/run)
//
// The opaque Anthropic conversation history and the approval decisions travel
// inside the AG-UI RunAgentInput's `forwardedProps` field, so the server keeps
// history in its native block shape instead of mapping lossily onto AG-UI's
// Message shape. The updated history, chart datasets, and pending writes travel
// back to the client over CUSTOM events (see the names below).
// ---------------------------------------------------------------------------

export type AgentRunForwardedProps = {
  messages: AnthropicMessage[]; // opaque history the client stores and resends
  approvals?: Approval[]; // approval decisions on a resume run
};

/** Which agent the dispatcher selected for a turn (Cycle 2). See dispatch.ts
 * on the server and docs/MULTI_AGENT.md. Shared so the client can tag turns. */
export type AgentKind = 'dairy' | 'vendor' | 'both';

/** CUSTOM event names used as app-specific side-channels over AG-UI. Renamed
 * from the Cycle 1 `dairy.*` names in Cycle 2: once a vendor write can also
 * pause a run, `dairy.pending` was misleading. See docs/MULTI_AGENT.md. */
export const AGENT_DATASET_EVENT = 'agent.dataset'; // value: Dataset
export const AGENT_MESSAGES_EVENT = 'agent.messages'; // value: AnthropicMessage[]
export const AGENT_PENDING_EVENT = 'agent.pending'; // value: PendingWrite[]
export const AGENT_SELECTION_EVENT = 'agent.selection'; // value: AgentKind

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
