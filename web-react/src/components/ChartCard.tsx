import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Dataset } from '../types';

export default function ChartCard({ dataset }: { dataset: Dataset }) {
  return (
    <div className="rounded-xl border border-farm-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-farm-800">
          {dataset.scopeLabel} — {dataset.interval}ly yield
        </h3>
        <span className="text-xs text-farm-500">{dataset.points.length} points</span>
      </div>
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={dataset.points} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e6d7b8" />
            <XAxis dataKey="periodStart" tick={{ fontSize: 11 }} stroke="#8a6431" />
            <YAxis tick={{ fontSize: 11 }} stroke="#8a6431" />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line
              type="monotone"
              dataKey="totalLitres"
              name="Total litres"
              stroke="#8a6431"
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="avgPerAnimal"
              name="Avg / animal"
              stroke="#c29b5c"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
