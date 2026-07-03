import { useCallback, useMemo, useState } from 'react';
import { postChat } from './api';
import ChatPanel from './components/ChatPanel';
import type {
  AnthropicMessage,
  Approval,
  Dataset,
  PendingWrite,
  ToolCallView,
} from './types';

export type TurnItem =
  | { id: string; role: 'user'; text: string }
  | {
      id: string;
      role: 'assistant';
      text: string;
      toolCalls: ToolCallView[];
      datasets: Dataset[];
    };

let idSeq = 0;
const nextId = () => `t_${++idSeq}`;

export default function App() {
  const [messages, setMessages] = useState<AnthropicMessage[]>([]);
  const [renderLog, setRenderLog] = useState<TurnItem[]>([]);
  const [pending, setPending] = useState<PendingWrite[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const busy = loading || pending !== null;

  const applyResponse = useCallback(
    (resp: Awaited<ReturnType<typeof postChat>>) => {
      setMessages(resp.messages);
      const hasContent =
        resp.render.assistantText ||
        resp.render.toolCalls.length > 0 ||
        resp.datasets.length > 0;
      if (hasContent) {
        setRenderLog((log) => [
          ...log,
          {
            id: nextId(),
            role: 'assistant',
            text: resp.render.assistantText,
            toolCalls: resp.render.toolCalls,
            datasets: resp.datasets,
          },
        ]);
      }
      setPending(resp.render.pendingWrites ?? null);
    },
    [],
  );

  const send = useCallback(
    async (text: string) => {
      if (busy) return;
      setError(null);
      const userMsg: AnthropicMessage = { role: 'user', content: text };
      const nextMessages = [...messages, userMsg];
      setMessages(nextMessages);
      setRenderLog((log) => [...log, { id: nextId(), role: 'user', text }]);
      setLoading(true);
      try {
        const resp = await postChat(nextMessages);
        applyResponse(resp);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Something went wrong.');
      } finally {
        setLoading(false);
      }
    },
    [busy, messages, applyResponse],
  );

  const resolve = useCallback(
    async (approvals: Approval[]) => {
      setError(null);
      setPending(null);
      setLoading(true);
      try {
        // Resend the unchanged messages + approval decisions.
        const resp = await postChat(messages, approvals);
        applyResponse(resp);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Something went wrong.');
      } finally {
        setLoading(false);
      }
    },
    [messages, applyResponse],
  );

  const isEmpty = useMemo(() => renderLog.length === 0, [renderLog]);

  return (
    <div className="h-full bg-farm-50 text-farm-900">
      <ChatPanel
        renderLog={renderLog}
        pending={pending}
        loading={loading}
        error={error}
        isEmpty={isEmpty}
        onSend={send}
        onResolve={resolve}
      />
    </div>
  );
}
