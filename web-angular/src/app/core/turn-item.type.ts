import type { AgentKind, Dataset, ToolCallView } from '@dairy/shared';

// Direct port of the `TurnItem` union from web-react/src/App.tsx.
export type TurnItem =
  | { id: string; role: 'user'; text: string }
  | {
      id: string;
      role: 'assistant';
      text: string;
      toolCalls: ToolCallView[];
      datasets: Dataset[];
      // Which agent handled this turn (Cycle 2). Null until the selection event
      // for the run arrives.
      agent: AgentKind | null;
    };
