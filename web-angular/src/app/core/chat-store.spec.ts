import { TestBed } from '@angular/core/testing';
import { HttpAgent } from '@ag-ui/client';
import type { BaseEvent } from '@ag-ui/core';
import type { AnthropicMessage } from '@dairy/shared';
import { ChatStore } from './chat-store';

type RunParams = { forwardedProps?: { messages: AnthropicMessage[]; approvals?: unknown } };

// Queue of scripted event sequences, one per expected runAgent() call.
let scripts: BaseEvent[][] = [];
let runSpy: ReturnType<typeof vi.spyOn>;

function ev(type: string, extra: Record<string, unknown> = {}): BaseEvent {
  return { type, ...extra } as unknown as BaseEvent;
}

describe('ChatStore', () => {
  let store: ChatStore;

  beforeEach(() => {
    scripts = [];
    runSpy = vi
      .spyOn(HttpAgent.prototype, 'runAgent')
      .mockImplementation(async (_params?: unknown, subscriber?: unknown) => {
        const evs = scripts.shift() ?? [];
        const onEvent = (subscriber as { onEvent?: (p: { event: BaseEvent }) => void })?.onEvent;
        for (const e of evs) onEvent?.({ event: e });
        return { result: undefined, newMessages: [] } as never;
      });
    TestBed.configureTestingModule({});
    store = TestBed.inject(ChatStore);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts empty and not busy', () => {
    expect(store.isEmpty()).toBe(true);
    expect(store.busy()).toBe(false);
    expect(store.messages()).toEqual([]);
    expect(store.renderLog()).toEqual([]);
    expect(store.pending()).toBeNull();
  });

  it('send() appends the user turn, then builds the assistant turn from events', async () => {
    const history: AnthropicMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello there' },
    ];
    scripts = [
      [
        ev('RUN_STARTED', { threadId: 't', runId: 'r' }),
        ev('TEXT_MESSAGE_START', { messageId: 'm1', role: 'assistant' }),
        ev('TEXT_MESSAGE_CONTENT', { messageId: 'm1', delta: 'hello there' }),
        ev('TEXT_MESSAGE_END', { messageId: 'm1' }),
        ev('TOOL_CALL_START', { toolCallId: 'x1', toolCallName: 'list_animals' }),
        ev('TOOL_CALL_ARGS', { toolCallId: 'x1', delta: '{}' }),
        ev('TOOL_CALL_END', { toolCallId: 'x1' }),
        ev('TOOL_CALL_RESULT', { toolCallId: 'x1', content: '{"count":1}' }),
        ev('CUSTOM', { name: 'dairy.messages', value: history }),
        ev('RUN_FINISHED', { threadId: 't', runId: 'r', outcome: { type: 'success' } }),
      ],
    ];

    await store.send('hi');

    expect(store.messages()).toEqual(history);

    const log = store.renderLog();
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ role: 'user', text: 'hi' });
    expect(log[1]).toMatchObject({ role: 'assistant', text: 'hello there', datasets: [] });
    const tcs = (log[1] as { toolCalls: { name: string; argSummary: string }[] }).toolCalls;
    expect(tcs).toHaveLength(1);
    expect(tcs[0].name).toBe('list_animals');
    expect(tcs[0].argSummary).toBe('list_animals()');

    expect(store.pending()).toBeNull();
    expect(store.loading()).toBe(false);
    expect(store.busy()).toBe(false);

    // Wire contract: the opaque history travels via forwardedProps.
    const params = runSpy.mock.calls[0][0] as RunParams;
    expect(params.forwardedProps?.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(params.forwardedProps?.approvals).toBeUndefined();
  });

  it('does not append an assistant turn when the run has no content', async () => {
    scripts = [
      [
        ev('RUN_STARTED', { threadId: 't', runId: 'r' }),
        ev('CUSTOM', { name: 'dairy.messages', value: [{ role: 'user', content: 'hi' }] }),
        ev('RUN_FINISHED', { threadId: 't', runId: 'r', outcome: { type: 'success' } }),
      ],
    ];

    await store.send('hi');

    expect(store.renderLog()).toHaveLength(1);
    expect(store.renderLog()[0]).toMatchObject({ role: 'user' });
  });

  it('surfaces pending writes from the interrupt and marks busy', async () => {
    const pending = [
      {
        toolUseId: 'w1',
        toolName: 'log_milking',
        summary: 'Log morning milking',
        details: [{ label: 'Session', value: 'morning' }],
      },
    ];
    scripts = [
      [
        ev('RUN_STARTED', { threadId: 't', runId: 'r' }),
        ev('TOOL_CALL_START', { toolCallId: 'w1', toolCallName: 'log_milking' }),
        ev('TOOL_CALL_END', { toolCallId: 'w1' }),
        ev('CUSTOM', { name: 'dairy.messages', value: [{ role: 'assistant', content: 'x' }] }),
        ev('CUSTOM', { name: 'dairy.pending', value: pending }),
        ev('RUN_FINISHED', {
          threadId: 't',
          runId: 'r',
          outcome: { type: 'interrupt', interrupts: [] },
        }),
      ],
    ];

    await store.send('log it');

    expect(store.pending()).toEqual(pending);
    expect(store.loading()).toBe(false);
    expect(store.busy()).toBe(true);
  });

  it('resolve() clears pending and resumes with history + approvals', async () => {
    const historyAfterInterrupt: AnthropicMessage[] = [{ role: 'assistant', content: 'need approval' }];
    scripts = [
      [
        ev('RUN_STARTED', { threadId: 't', runId: 'r1' }),
        ev('TOOL_CALL_START', { toolCallId: 'w1', toolCallName: 'log_milking' }),
        ev('TOOL_CALL_END', { toolCallId: 'w1' }),
        ev('CUSTOM', { name: 'dairy.messages', value: historyAfterInterrupt }),
        ev('CUSTOM', {
          name: 'dairy.pending',
          value: [{ toolUseId: 'w1', toolName: 'log_milking', summary: 's', details: [] }],
        }),
        ev('RUN_FINISHED', {
          threadId: 't',
          runId: 'r1',
          outcome: { type: 'interrupt', interrupts: [] },
        }),
      ],
      [
        ev('RUN_STARTED', { threadId: 't', runId: 'r2' }),
        ev('TOOL_CALL_RESULT', { toolCallId: 'w1', content: '{"inserted":1}' }),
        ev('TEXT_MESSAGE_START', { messageId: 'm2', role: 'assistant' }),
        ev('TEXT_MESSAGE_CONTENT', { messageId: 'm2', delta: 'Logged.' }),
        ev('TEXT_MESSAGE_END', { messageId: 'm2' }),
        ev('CUSTOM', { name: 'dairy.messages', value: [{ role: 'assistant', content: 'done' }] }),
        ev('RUN_FINISHED', { threadId: 't', runId: 'r2', outcome: { type: 'success' } }),
      ],
    ];

    await store.send('log it');
    expect(store.busy()).toBe(true);

    const approvals = [{ toolUseId: 'w1', approved: true }];
    await store.resolve(approvals);

    expect(store.pending()).toBeNull();
    expect(store.busy()).toBe(false);

    const params = runSpy.mock.calls[1][0] as RunParams;
    expect(params.forwardedProps?.messages).toEqual(historyAfterInterrupt);
    expect(params.forwardedProps?.approvals).toEqual(approvals);
  });

  it('send() is a no-op while busy', async () => {
    scripts = [
      [
        ev('RUN_STARTED', { threadId: 't', runId: 'r' }),
        ev('CUSTOM', {
          name: 'dairy.pending',
          value: [{ toolUseId: 'w1', toolName: 'log_milking', summary: 's', details: [] }],
        }),
        ev('RUN_FINISHED', {
          threadId: 't',
          runId: 'r',
          outcome: { type: 'interrupt', interrupts: [] },
        }),
      ],
    ];
    await store.send('first');
    expect(store.busy()).toBe(true);

    const logLen = store.renderLog().length;
    await store.send('second while busy');
    expect(store.renderLog().length).toBe(logLen);
    expect(runSpy).toHaveBeenCalledTimes(1);
  });

  it('sets an error message on RUN_ERROR', async () => {
    scripts = [
      [
        ev('RUN_STARTED', { threadId: 't', runId: 'r' }),
        ev('RUN_ERROR', { message: 'The database has not been seeded yet.', code: 'unavailable' }),
      ],
    ];
    await store.send('hi');
    expect(store.error()).toBe('The database has not been seeded yet.');
    expect(store.loading()).toBe(false);
  });
});
