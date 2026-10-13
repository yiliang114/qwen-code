/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DaemonEvent } from '@qwen-code/sdk/daemon';
import { StandaloneDaemonTransport } from './standalone-transport.js';

const tab = {
  id: 7,
  index: 0,
  pinned: false,
  highlighted: true,
  active: true,
  frozen: false,
  incognito: false,
  selected: true,
  discarded: false,
  autoDiscardable: true,
  groupId: -1,
  windowId: 1,
  title: 'Example',
  url: 'https://example.test/page',
};

function stubChrome() {
  const storage: Record<string, unknown> = {};
  const sendCommand = vi.fn(
    (
      _target: chrome.debugger.Debuggee,
      _method: string,
      _params: object,
      callback?: (result?: object) => void,
    ) => callback?.({}),
  );
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
        set: vi.fn(async (values: Record<string, unknown>) =>
          Object.assign(storage, values),
        ),
      },
    },
    tabs: {
      query: vi.fn().mockResolvedValue([tab]),
      get: vi.fn().mockResolvedValue(tab),
    },
    debugger: {
      onEvent: { addListener: vi.fn() },
      onDetach: { addListener: vi.fn() },
      attach: vi.fn((_target, _version, callback) => callback()),
      detach: vi.fn((_target, callback) => callback()),
      sendCommand,
    },
    runtime: {
      lastError: undefined,
      getManifest: () => ({ version: '0.1.0' }),
      getPlatformInfo: vi.fn((callback) => callback()),
    },
  });
  return { sendCommand };
}

function createTransport() {
  return new StandaloneDaemonTransport({
    getConfig: async () => ({
      apiKey: 'test-key',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen3-coder-plus',
    }),
    setModel: vi.fn(),
  });
}

async function createSession(
  transport: StandaloneDaemonTransport,
): Promise<string> {
  const response = await transport.restFetch(
    'https://standalone.invalid/session',
    { method: 'POST' },
  );
  return String((await response.json())['sessionId']);
}

async function collectTurn(
  transport: StandaloneDaemonTransport,
  sessionId: string,
  onEvent?: (event: DaemonEvent) => Promise<void>,
): Promise<DaemonEvent[]> {
  const controller = new AbortController();
  const events: DaemonEvent[] = [];
  for await (const event of transport.subscribeEvents(sessionId, {
    signal: controller.signal,
  })) {
    events.push(event);
    await onEvent?.(event);
    if (event.type === 'turn_complete' || event.type === 'turn_error') {
      controller.abort();
      return events;
    }
  }
  return events;
}

describe('StandaloneDaemonTransport', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    stubChrome();
  });

  it('exposes the full browser toolset through the Web Shell transport', async () => {
    const transport = createTransport();

    const response = await transport.restFetch(
      'https://standalone.invalid/workspaces/%2Fbrowser/tools',
      {},
    );
    const payload = (await response.json()) as {
      tools: Array<{ name: string }>;
    };

    expect(payload.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        'take_snapshot',
        'click',
        'evaluate_script',
        'list_network_requests',
        'send_request',
      ]),
    );
    expect(payload.tools).toHaveLength(20);
    transport.dispose();
  });

  it('streams assistant turns in the daemon event format', async () => {
    const transport = createTransport();
    const sessionId = await createSession(transport);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'The tab is ready.' } }],
          }),
        ),
      ),
    );
    const eventsPromise = collectTurn(transport, sessionId);

    await transport.restFetch(
      `https://standalone.invalid/session/${sessionId}/prompt`,
      {
        method: 'POST',
        body: JSON.stringify({
          prompt: [{ type: 'text', text: 'Check the tab' }],
        }),
      },
    );
    const events = await eventsPromise;

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'session_update',
          data: {
            update: expect.objectContaining({
              sessionUpdate: 'agent_message_chunk',
              content: { type: 'text', text: 'The tab is ready.' },
            }),
          },
        }),
        expect.objectContaining({ type: 'turn_complete' }),
      ]),
    );
    transport.dispose();
  });

  it('persists rename, archive, and delete actions from the Web Shell sidebar', async () => {
    const transport = createTransport();
    const sessionId = await createSession(transport);

    await transport.restFetch(
      `https://standalone.invalid/session/${sessionId}/metadata`,
      {
        method: 'PATCH',
        body: JSON.stringify({ displayName: 'Research tab' }),
      },
    );
    await transport.restFetch('https://standalone.invalid/sessions/archive', {
      method: 'POST',
      body: JSON.stringify({ sessionIds: [sessionId] }),
    });
    const archived = await transport.restFetch(
      'https://standalone.invalid/workspaces/%2Fbrowser/sessions?archiveState=archived',
      {},
    );
    expect(await archived.json()).toMatchObject({
      sessions: [
        {
          sessionId,
          displayName: 'Research tab',
          isArchived: true,
        },
      ],
    });

    const deleted = await transport.restFetch(
      'https://standalone.invalid/sessions/delete',
      {
        method: 'POST',
        body: JSON.stringify({ sessionIds: [sessionId] }),
      },
    );
    expect(await deleted.json()).toEqual({
      removed: [sessionId],
      notFound: [],
      errors: [],
    });
    transport.dispose();
  });

  it('routes state-changing tools through Web Shell permission requests', async () => {
    const { sendCommand } = stubChrome();
    const transport = createTransport();
    const sessionId = await createSession(transport);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    tool_calls: [
                      {
                        id: 'call-1',
                        type: 'function',
                        function: {
                          name: 'navigate_page',
                          arguments: '{"url":"https://example.org"}',
                        },
                      },
                    ],
                  },
                },
              ],
            }),
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              choices: [
                { message: { content: 'Navigation was not performed.' } },
              ],
            }),
          ),
        ),
    );
    let permissionRequest: Record<string, unknown> | undefined;
    const eventsPromise = collectTurn(transport, sessionId, async (event) => {
      if (event.type !== 'permission_request') return;
      permissionRequest = event.data as Record<string, unknown>;
      const requestId = String(
        (event.data as Record<string, unknown>)['requestId'],
      );
      await transport.restFetch(
        `https://standalone.invalid/session/${sessionId}/permission/${requestId}`,
        {
          method: 'POST',
          body: JSON.stringify({
            outcome: { outcome: 'selected', optionId: 'reject_once' },
          }),
        },
      );
    });

    await transport.restFetch(
      `https://standalone.invalid/session/${sessionId}/prompt`,
      {
        method: 'POST',
        body: JSON.stringify({
          prompt: [{ type: 'text', text: 'Open example.org' }],
        }),
      },
    );
    const events = await eventsPromise;

    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(['permission_request', 'permission_resolved']),
    );
    expect(permissionRequest).toMatchObject({
      toolCall: {
        toolCallId: 'call-1',
        name: 'navigate_page',
        status: 'pending',
      },
      options: [
        { optionId: 'allow_once', kind: 'allow_once' },
        { optionId: 'reject_once', kind: 'reject_once' },
      ],
    });
    expect(
      sendCommand.mock.calls.some((call) => call[1] === 'Page.navigate'),
    ).toBe(false);
    transport.dispose();
  });
});
