import type { TurnItem } from '../App';
import Message from './Message';

export default function MessageList({ renderLog }: { renderLog: TurnItem[] }) {
  return (
    <div className="space-y-5">
      {renderLog.map((item) => (
        <Message key={item.id} item={item} />
      ))}
    </div>
  );
}
