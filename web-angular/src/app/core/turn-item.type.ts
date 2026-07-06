import type { Dataset, ToolCallView } from '@dairy/shared';

// Direct port of the `TurnItem` union from web-react/src/App.tsx.
export type TurnItem =
  | { id: string; role: 'user'; text: string }
  | {
      id: string;
      role: 'assistant';
      text: string;
      toolCalls: ToolCallView[];
      datasets: Dataset[];
    };
