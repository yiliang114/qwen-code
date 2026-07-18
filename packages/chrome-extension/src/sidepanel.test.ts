/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const html = await readFile('public/sidepanel.html', 'utf8');
const manifest = JSON.parse(
  await readFile('public/manifest.json', 'utf8'),
) as chrome.runtime.ManifestV3;

async function loadSidepanel(initial?: {
  local?: Record<string, unknown>;
  session?: Record<string, unknown>;
}): Promise<{
  local: {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
  session: {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
  debuggerApi: {
    sendCommand: ReturnType<typeof vi.fn>;
  };
}> {
  document.open();
  document.write(html);
  document.close();
  const local = {
    get: vi.fn().mockResolvedValue(initial?.local ?? {}),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  };
  const session = {
    get: vi.fn().mockResolvedValue(initial?.session ?? {}),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  };
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
  const debuggerApi = {
    onEvent: { addListener: vi.fn() },
    onDetach: { addListener: vi.fn() },
    attach: vi.fn((_target, _version, callback) => callback()),
    detach: vi.fn((_target, callback) => callback()),
    sendCommand: vi.fn((_target, _method, _params, callback) => callback({})),
  };
  vi.stubGlobal('chrome', {
    storage: { local, session },
    tabs: {
      query: vi.fn().mockResolvedValue([tab]),
      get: vi.fn().mockResolvedValue(tab),
    },
    debugger: debuggerApi,
    runtime: {
      lastError: undefined,
      getPlatformInfo: vi.fn((callback) => callback()),
    },
  });
  Element.prototype.scrollIntoView = vi.fn();
  await import('./sidepanel.js');
  return { local, session, debuggerApi };
}

describe('standalone side panel', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('loads the real side-panel document without a missing element', async () => {
    await expect(loadSidepanel()).resolves.toBeDefined();
    expect(document.getElementById('composer')).not.toBeNull();
  });

  it('grants access to the China Token Plan endpoint', () => {
    expect(manifest.host_permissions).toContain(
      'https://token-plan.cn-beijing.maas.aliyuncs.com/*',
    );
  });

  it('keeps the API key in session storage by default', async () => {
    const { local, session } = await loadSidepanel();
    const key = document.getElementById('api-key') as HTMLInputElement;
    key.value = 'session-key';

    document
      .getElementById('settings-form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() =>
      expect(session.set).toHaveBeenCalledWith({
        'qwen.standalone.apiKey': 'session-key',
      }),
    );
    expect(local.remove).toHaveBeenCalledWith('qwen.standalone.apiKey');
  });

  it('moves an explicitly remembered API key to local storage', async () => {
    const { local, session } = await loadSidepanel();
    const key = document.getElementById('api-key') as HTMLInputElement;
    const remember = document.getElementById(
      'remember-key',
    ) as HTMLInputElement;
    key.value = 'persistent-key';
    remember.checked = true;

    document
      .getElementById('settings-form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() =>
      expect(local.set).toHaveBeenCalledWith({
        'qwen.standalone.apiKey': 'persistent-key',
      }),
    );
    expect(session.remove).toHaveBeenCalledWith('qwen.standalone.apiKey');
  });

  it('loads a non-persistent API key only from session storage', async () => {
    await loadSidepanel({
      local: {
        'qwen.standalone.settings': {
          rememberKey: false,
          model: 'qwen3-coder-plus',
        },
        'qwen.standalone.apiKey': 'stale-local-key',
      },
      session: { 'qwen.standalone.apiKey': 'session-key' },
    });

    await vi.waitFor(() =>
      expect(
        (document.getElementById('api-key') as HTMLInputElement).value,
      ).toBe('session-key'),
    );
  });

  it('loads a remembered API key without reading session storage', async () => {
    const { session } = await loadSidepanel({
      local: {
        'qwen.standalone.settings': {
          rememberKey: true,
          model: 'qwen3-coder-plus',
        },
        'qwen.standalone.apiKey': 'local-key',
      },
      session: { 'qwen.standalone.apiKey': 'stale-session-key' },
    });

    await vi.waitFor(() =>
      expect(
        (document.getElementById('api-key') as HTMLInputElement).value,
      ).toBe('local-key'),
    );
    expect(session.get).not.toHaveBeenCalled();
  });

  it('advertises only the standalone browser-tool allowlist', async () => {
    await loadSidepanel();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'Done.' } }],
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchImpl);
    (document.getElementById('api-key') as HTMLInputElement).value = 'test-key';
    (document.getElementById('prompt') as HTMLTextAreaElement).value =
      'Summarize this page';

    document
      .getElementById('composer')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    const body = JSON.parse(
      fetchImpl.mock.calls[0]![1]!.body as string,
    ) as Record<string, unknown>;
    const toolNames = (
      body['tools'] as Array<{ function: { name: string } }>
    ).map((tool) => tool.function.name);
    expect(toolNames).toContain('take_snapshot');
    expect(toolNames).toContain('click');
    expect(toolNames).not.toContain('evaluate_script');
    expect(toolNames).not.toContain('list_network_requests');
    expect(toolNames).not.toContain('send_request');
  });

  it('asks before navigation and does not act when denied', async () => {
    const { debuggerApi } = await loadSidepanel();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const fetchImpl = vi
      .fn<typeof fetch>()
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
            choices: [{ message: { content: 'Navigation was denied.' } }],
          }),
        ),
      );
    vi.stubGlobal('fetch', fetchImpl);
    (document.getElementById('api-key') as HTMLInputElement).value = 'test-key';
    (document.getElementById('prompt') as HTMLTextAreaElement).value =
      'Open example.org';

    document
      .getElementById('composer')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining('navigate_page on https://example.test'),
    );
    expect(
      debuggerApi.sendCommand.mock.calls.some(
        (call) => call[1] === 'Page.navigate',
      ),
    ).toBe(false);
  });
});
