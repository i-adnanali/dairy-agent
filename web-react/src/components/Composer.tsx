import { useState } from 'react';

interface Props {
  disabled: boolean;
  onSend: (text: string) => void;
}

export default function Composer({ disabled, onSend }: Props) {
  const [value, setValue] = useState('');

  const submit = () => {
    const text = value.trim();
    if (!text || disabled) return;
    onSend(text);
    setValue('');
  };

  return (
    <div className="border-t border-farm-200 bg-farm-50 px-6 py-4">
      <div className="flex items-end gap-2">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          disabled={disabled}
          rows={1}
          placeholder={
            disabled ? 'Resolve the pending action above to continue…' : 'Ask about the herd, or request an action…'
          }
          className="max-h-40 min-h-[44px] flex-1 resize-none rounded-xl border border-farm-300 bg-white px-3 py-2.5 text-sm text-farm-900 outline-none focus:border-farm-500 disabled:bg-farm-100 disabled:text-farm-400"
        />
        <button
          onClick={submit}
          disabled={disabled || !value.trim()}
          className="rounded-xl bg-farm-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-farm-700 disabled:cursor-not-allowed disabled:bg-farm-300"
        >
          Send
        </button>
      </div>
    </div>
  );
}
