import type { Approval, PendingWrite } from '../types';

interface Props {
  card: PendingWrite;
  onResolve: (approvals: Approval[]) => void;
}

export default function ConfirmationCard({ card, onResolve }: Props) {
  return (
    <div className="rounded-xl border-2 border-farm-300 bg-farm-100 p-4 shadow-sm">
      <div className="mb-1 flex items-center gap-2">
        <span className="rounded-full bg-farm-600 px-2 py-0.5 text-xs font-medium text-white">
          Confirm action
        </span>
        <span className="font-mono text-xs text-farm-600">{card.toolName}</span>
      </div>

      <p className="mb-3 text-sm font-medium text-farm-900">{card.summary}</p>

      <dl className="mb-3 grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-sm">
        {card.details.map((d) => (
          <div key={d.label} className="contents">
            <dt className="text-farm-500">{d.label}</dt>
            <dd className="text-farm-900">{d.value}</dd>
          </div>
        ))}
      </dl>

      {card.rows && card.rows.length > 0 && (
        <table className="mb-3 w-full text-sm">
          <thead>
            <tr className="border-b border-farm-200 text-left text-farm-500">
              <th className="py-1 font-medium">Animal</th>
              <th className="py-1 text-right font-medium">Value</th>
            </tr>
          </thead>
          <tbody>
            {card.rows.map((r, i) => (
              <tr key={i} className="border-b border-farm-200/60 last:border-0">
                <td className="py-1">
                  {r.tag}
                  {r.name ? ` · ${r.name}` : ''}
                </td>
                <td className="py-1 text-right tabular-nums">{r.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="flex gap-2">
        <button
          className="rounded-md bg-farm-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-farm-700"
          onClick={() => onResolve([{ toolUseId: card.toolUseId, approved: true }])}
        >
          Approve
        </button>
        <button
          className="rounded-md border border-farm-300 bg-white px-3 py-1.5 text-sm font-medium text-farm-700 hover:bg-farm-50"
          onClick={() => onResolve([{ toolUseId: card.toolUseId, approved: false }])}
        >
          Reject
        </button>
      </div>
    </div>
  );
}
