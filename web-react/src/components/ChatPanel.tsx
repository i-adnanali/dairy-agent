import { useEffect, useRef } from 'react';
import type { TurnItem } from '../App';
import type { Approval, PendingWrite } from '../types';
import Composer from './Composer';
import ConfirmationCard from './ConfirmationCard';
import EmptyState from './EmptyState';
import MessageList from './MessageList';

interface Props {
  renderLog: TurnItem[];
  pending: PendingWrite[] | null;
  loading: boolean;
  error: string | null;
  isEmpty: boolean;
  onSend: (text: string) => void;
  onResolve: (approvals: Approval[]) => void;
}

export default function ChatPanel({
  renderLog,
  pending,
  loading,
  error,
  isEmpty,
  onSend,
  onResolve,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [renderLog, pending, loading]);

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col">
      <header className="border-b border-farm-200 bg-farm-50/80 px-6 py-4 backdrop-blur">
        <h1 className="text-lg font-semibold tracking-tight">Dairy Farm Agent</h1>
        <p className="text-sm text-farm-600">
          Ask about your herd, milk yields, feed, and health — and take actions with confirmation.
        </p>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6">
        {isEmpty ? (
          <EmptyState onPick={onSend} />
        ) : (
          <MessageList renderLog={renderLog} />
        )}

        {loading && (
          <div className="mt-4 flex items-center gap-2 text-sm text-farm-500">
            <span className="h-2 w-2 animate-pulse rounded-full bg-farm-400" />
            Thinking…
          </div>
        )}

        {pending && pending.length > 0 && (
          <div className="mt-4 space-y-3">
            {pending.map((card) => (
              <ConfirmationCard key={card.toolUseId} card={card} onResolve={onResolve} />
            ))}
            {pending.length > 1 && (
              <button
                className="rounded-md bg-farm-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-farm-700"
                onClick={() =>
                  onResolve(pending.map((c) => ({ toolUseId: c.toolUseId, approved: true })))
                }
              >
                Approve all ({pending.length})
              </button>
            )}
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
      </div>

      <Composer disabled={loading || pending !== null} onSend={onSend} />
    </div>
  );
}
