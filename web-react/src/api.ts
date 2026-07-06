import type { Approval, AnthropicMessage, ChatResponse } from './types';

export async function postChat(
  messages: AnthropicMessage[],
  approvals?: Approval[],
): Promise<ChatResponse> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, approvals }),
  });
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.message) detail = body.message;
    } catch {
      // ignore
    }
    throw new Error(detail);
  }
  return (await res.json()) as ChatResponse;
}
