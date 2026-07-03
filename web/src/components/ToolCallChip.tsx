import { useState } from 'react';
import type { ToolCallView } from '../types';

export default function ToolCallChip({ call }: { call: ToolCallView }) {
  const [open, setOpen] = useState(false);
  const isError = call.status === 'error';

  return (
    <button
      onClick={() => setOpen((o) => !o)}
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${
        isError
          ? 'border-red-300 bg-red-50 text-red-700'
          : 'border-farm-200 bg-farm-100 text-farm-700 hover:bg-farm-200'
      }`}
      title={call.argSummary}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${isError ? 'bg-red-500' : 'bg-emerald-500'}`} />
      <span className="font-medium">{call.name}</span>
      <span className="opacity-70">{call.status}</span>
      {open && <span className="ml-1 truncate font-mono opacity-80">{call.argSummary}</span>}
    </button>
  );
}
