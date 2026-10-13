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
}) {
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
  vi.stubGlobal('chrome', {
    storage: { local, session },
    tabs: {
      query: vi.fn().mockResolvedValue([]),
      get: vi.fn(),
    },
    debugger: {
      onEvent: { addListener: vi.fn() },
      onDetach: { addListener: vi.fn() },
      attach: vi.fn(),
      detach: vi.fn(),
      sendCommand: vi.fn(),
    },
    runtime: {
      lastError: undefined,
      getManifest: () => manifest,
      getPlatformInfo: vi.fn((callback) => callback()),
    },
  });
  Element.prototype.scrollIntoView = vi.fn();
  await import('./sidepanel.js');
  return { local, session };
}

function setInput(id: string, value: string): void {
  const input = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('standalone side panel', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('shows local settings before the first browser chat', async () => {
    await loadSidepanel();

    await vi.waitFor(() =>
      expect(document.getElementById('settings-form')).not.toBeNull(),
    );
    expect(document.getElementById('web-shell')).toBeNull();
    expect(document.body.textContent).toContain('Import settings.json');
  });

  it('grants access only to supported ModelStudio endpoints', () => {
    expect(manifest.host_permissions).toEqual([
      'https://dashscope.aliyuncs.com/*',
      'https://dashscope-intl.aliyuncs.com/*',
      'https://dashscope-us.aliyuncs.com/*',
      'https://token-plan.cn-beijing.maas.aliyuncs.com/*',
    ]);
  });

  it('keeps the API key in session storage by default', async () => {
    const { local, session } = await loadSidepanel();
    await vi.waitFor(() =>
      expect(document.getElementById('api-key')).not.toBeNull(),
    );
    setInput('api-key', 'session-key');

    document
      .getElementById('settings-form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() =>
      expect(session.set).toHaveBeenCalledWith({
        'qwen.standalone.apiKey': 'session-key',
      }),
    );
    expect(local.remove).toHaveBeenCalledWith('qwen.standalone.apiKey');
    await vi.waitFor(() =>
      expect(document.getElementById('web-shell')).not.toBeNull(),
    );
  });

  it('moves an explicitly remembered API key to local storage', async () => {
    const { local, session } = await loadSidepanel();
    await vi.waitFor(() =>
      expect(document.getElementById('api-key')).not.toBeNull(),
    );
    setInput('api-key', 'persistent-key');
    (document.getElementById('remember-key') as HTMLInputElement).click();

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

  it('loads session-only credentials into the formal Web Shell', async () => {
    const { session } = await loadSidepanel({
      local: {
        'qwen.standalone.settings': {
          rememberKey: false,
          model: 'qwen3-coder-plus',
        },
      },
      session: { 'qwen.standalone.apiKey': 'session-key' },
    });

    await vi.waitFor(() =>
      expect(document.getElementById('web-shell')).not.toBeNull(),
    );
    expect(document.getElementById('settings-form')).toBeNull();
    expect(session.get).toHaveBeenCalledWith('qwen.standalone.apiKey');
  });

  it('loads remembered credentials and preserves the checkbox', async () => {
    const { session } = await loadSidepanel({
      local: {
        'qwen.standalone.settings': {
          rememberKey: true,
          model: 'glm-5.2',
        },
        'qwen.standalone.apiKey': 'local-key',
      },
    });

    await vi.waitFor(() =>
      expect(document.getElementById('web-shell-status-0')).not.toBeNull(),
    );
    document.getElementById('web-shell-status-0')!.click();
    await vi.waitFor(() =>
      expect(document.getElementById('settings-form')).not.toBeNull(),
    );
    expect(
      (document.getElementById('remember-key') as HTMLInputElement).checked,
    ).toBe(true);
    expect((document.getElementById('model') as HTMLInputElement).value).toBe(
      'glm-5.2',
    );
    expect(session.get).not.toHaveBeenCalled();
  });

  it('recovers from invalid stored settings by reopening configuration', async () => {
    await loadSidepanel({
      local: {
        'qwen.standalone.settings': {
          rememberKey: true,
          baseUrl: 'https://example.com/v1',
        },
        'qwen.standalone.apiKey': 'local-key',
      },
    });

    await vi.waitFor(() =>
      expect(document.getElementById('settings-form')).not.toBeNull(),
    );
    expect(document.getElementById('web-shell')).toBeNull();
  });
});
