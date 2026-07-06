import { TestBed } from '@angular/core/testing';
import type { ChatResponse } from '@dairy/shared';
import { ChatStore } from './chat-store';

function mockFetchOnce(resp: ChatResponse) {
  const fetchMock = vi.fn(async (_url?: string, _init?: RequestInit) => ({
    ok: true,
    json: async () => resp,
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function mockFetchError(status: number, body?: { message?: string }) {
  const fetchMock = vi.fn(async (_url?: string, _init?: RequestInit) => ({
    ok: false,
    status,
    json: async () => body ?? {},
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('ChatStore', () => {
  let store: ChatStore;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(ChatStore);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('starts empty and not busy', () => {
    expect(store.isEmpty()).toBe(true);
    expect(store.busy()).toBe(false);
    expect(store.messages()).toEqual([]);
    expect(store.renderLog()).toEqual([]);
    expect(store.pending()).toBeNull();
  });

  it('send() appends the user turn, then applies the assistant response', async () => {
    const resp: ChatResponse = {
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello there' },
      ],
      render: {
        assistantText: 'hello there',
        toolCalls: [
          { toolUseId: 'x1', name: 'list_animals', status: 'done', argSummary: '{}' },
        ],
      },
      datasets: [],
      done: true,
    };
    const fetchMock = mockFetchOnce(resp);

    await store.send('hi');

    // messages are replaced by the server's opaque history (matches React applyResponse).
    expect(store.messages()).toEqual(resp.messages);

    // renderLog has the user turn followed by the assistant turn.
    const log = store.renderLog();
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ role: 'user', text: 'hi' });
    expect(log[1]).toMatchObject({
      role: 'assistant',
      text: 'hello there',
      datasets: [],
    });
    expect((log[1] as { toolCalls: unknown[] }).toolCalls).toHaveLength(1);

    expect(store.pending()).toBeNull();
    expect(store.loading()).toBe(false);
    expect(store.busy()).toBe(false);
    expect(store.isEmpty()).toBe(false);

    // Verify the wire contract of the request body.
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/chat',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'hi' }],
          approvals: undefined,
        }),
      }),
    );
  });

  it('does not append an assistant turn when the response has no content', async () => {
    const resp: ChatResponse = {
      messages: [{ role: 'user', content: 'hi' }],
      render: { assistantText: '', toolCalls: [] },
      datasets: [],
      done: false,
    };
    mockFetchOnce(resp);

    await store.send('hi');

    // Only the user turn is present (no empty assistant bubble).
    expect(store.renderLog()).toHaveLength(1);
    expect(store.renderLog()[0]).toMatchObject({ role: 'user' });
  });

  it('surfaces pendingWrites and marks busy while awaiting approval', async () => {
    const pending = [
      {
        toolUseId: 'w1',
        toolName: 'log_milking',
        summary: 'Log morning milking',
        details: [{ label: 'Session', value: 'morning' }],
      },
    ];
    const resp: ChatResponse = {
      messages: [{ role: 'assistant', content: 'need approval' }],
      render: { assistantText: 'need approval', toolCalls: [], pendingWrites: pending },
      datasets: [],
      done: false,
    };
    mockFetchOnce(resp);

    await store.send('log it');

    expect(store.pending()).toEqual(pending);
    // loading is false but pending !== null => busy.
    expect(store.loading()).toBe(false);
    expect(store.busy()).toBe(true);
  });

  it('resolve() clears pending and resends messages with approvals', async () => {
    // First: reach a pending state.
    mockFetchOnce({
      messages: [{ role: 'assistant', content: 'need approval' }],
      render: {
        assistantText: 'need approval',
        toolCalls: [],
        pendingWrites: [
          { toolUseId: 'w1', toolName: 'log_milking', summary: 's', details: [] },
        ],
      },
      datasets: [],
      done: false,
    });
    await store.send('log it');
    expect(store.busy()).toBe(true);

    // Then: resolve.
    const approvals = [{ toolUseId: 'w1', approved: true }];
    const fetchMock = mockFetchOnce({
      messages: [{ role: 'assistant', content: 'done' }],
      render: { assistantText: 'Logged.', toolCalls: [] },
      datasets: [],
      done: true,
    });

    await store.resolve(approvals);

    expect(store.pending()).toBeNull();
    expect(store.busy()).toBe(false);
    const lastCall = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(lastCall.body as string)).toEqual({
      messages: [{ role: 'assistant', content: 'need approval' }],
      approvals,
    });
  });

  it('send() is a no-op while busy', async () => {
    mockFetchOnce({
      messages: [{ role: 'assistant', content: 'need approval' }],
      render: {
        assistantText: '',
        toolCalls: [],
        pendingWrites: [
          { toolUseId: 'w1', toolName: 'log_milking', summary: 's', details: [] },
        ],
      },
      datasets: [],
      done: false,
    });
    await store.send('first');
    expect(store.busy()).toBe(true);

    const logLen = store.renderLog().length;
    await store.send('second while busy');
    expect(store.renderLog().length).toBe(logLen);
  });

  it('sets an error message when the request fails', async () => {
    mockFetchError(503, { message: 'The database has not been seeded yet.' });
    await store.send('hi');
    expect(store.error()).toBe('The database has not been seeded yet.');
    expect(store.loading()).toBe(false);
  });
});
