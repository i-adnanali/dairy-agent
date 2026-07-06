import DOMPurify from 'dompurify';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { TurnItem } from '../App';
import ChartCard from './ChartCard';
import ToolCallChip from './ToolCallChip';

export default function Message({ item }: { item: TurnItem }) {
  if (item.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-farm-600 px-4 py-2.5 text-sm text-white shadow-sm">
          {item.text}
        </div>
      </div>
    );
  }

  const cleanText = DOMPurify.sanitize(item.text || '');

  return (
    <div className="flex flex-col items-start gap-2">
      {item.text && (
        <div className="prose-chat max-w-[85%] rounded-2xl rounded-bl-sm border border-farm-200 bg-white px-4 py-3 text-sm text-farm-900 shadow-sm">
          <Markdown
            remarkPlugins={[remarkGfm]}
            allowedElements={[
              'p', 'strong', 'em', 'ul', 'ol', 'li', 'code', 'pre', 'a', 'h1', 'h2', 'h3', 'br', 'blockquote',
              'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'del',
            ]}
            unwrapDisallowed
          >
            {cleanText}
          </Markdown>
        </div>
      )}

      {item.toolCalls.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {item.toolCalls.map((tc) => (
            <ToolCallChip key={tc.toolUseId} call={tc} />
          ))}
        </div>
      )}

      {item.datasets.length > 0 && (
        <div className="w-full space-y-3">
          {item.datasets.map((ds) => (
            <ChartCard key={ds.datasetId} dataset={ds} />
          ))}
        </div>
      )}
    </div>
  );
}
