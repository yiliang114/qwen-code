/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserTools } from './background/browser-mcp/browser-tools.js';
import { ChromeDebuggerSession } from './background/browser-mcp/debugger-session.js';
import {
  runAgent,
  validateModelBaseUrl,
  type ChatMessage,
  type ModelConfig,
} from './standalone-agent.js';

const SETTINGS_KEY = 'qwen.standalone.settings';
const API_KEY = 'qwen.standalone.apiKey';
const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DEFAULT_MODEL = 'qwen3-coder-plus';
const READ_ONLY_TOOLS = new Set(['take_snapshot', 'wait_for']);
const ALLOWED_TOOLS = new Set([
  'take_snapshot',
  'navigate_page',
  'reload_page',
  'go_back',
  'go_forward',
  'click',
  'fill',
  'fill_form',
  'press_key',
  'scroll_page',
  'wait_for',
]);

interface StoredSettings {
  baseUrl?: string;
  model?: string;
  rememberKey?: boolean;
}

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing element #${id}`);
  return value as T;
}

const settingsPanel = element<HTMLDetailsElement>('settings-panel');
const settingsForm = element<HTMLFormElement>('settings-form');
const baseUrlInput = element<HTMLInputElement>('base-url');
const modelInput = element<HTMLInputElement>('model');
const apiKeyInput = element<HTMLInputElement>('api-key');
const rememberKeyInput = element<HTMLInputElement>('remember-key');
const settingsStatus = element<HTMLSpanElement>('settings-status');
const messagesElement = element<HTMLElement>('messages');
const welcomeElement = element<HTMLElement>('welcome');
const runStatus = element<HTMLElement>('run-status');
const composer = element<HTMLFormElement>('composer');
const promptInput = element<HTMLTextAreaElement>('prompt');
const sendButton = element<HTMLButtonElement>('send');
const stopButton = element<HTMLButtonElement>('stop');
const clearButton = element<HTMLButtonElement>('clear');

const browserSession = new ChromeDebuggerSession();
const browserTools = new BrowserTools(browserSession, false, approveTool);
const tools = browserTools.tools.filter((tool) => ALLOWED_TOOLS.has(tool.name));
let messages: ChatMessage[] = [];
let controller: AbortController | null = null;

function appendMessage(
  kind: 'user' | 'assistant' | 'error',
  text: string,
): void {
  welcomeElement.classList.add('hidden');
  const node = document.createElement('div');
  node.className = `message ${kind}`;
  node.textContent = text;
  messagesElement.append(node);
  node.scrollIntoView({ block: 'end' });
}

function appendTool(name: string, args: Record<string, unknown>): void {
  const node = document.createElement('div');
  node.className = 'tool-event';
  node.textContent = `Requested ${name} ${JSON.stringify(args)}`;
  messagesElement.append(node);
  node.scrollIntoView({ block: 'end' });
}

function setBusy(busy: boolean): void {
  sendButton.disabled = busy;
  promptInput.disabled = busy;
  clearButton.disabled = busy;
  stopButton.classList.toggle('hidden', !busy);
}

function currentConfig(): ModelConfig {
  const apiKey = apiKeyInput.value.trim();
  const model = modelInput.value.trim();
  if (!apiKey) throw new Error('Enter a ModelStudio API key');
  if (!model) throw new Error('Enter a model name');
  return {
    apiKey,
    model,
    baseUrl: validateModelBaseUrl(baseUrlInput.value.trim()),
  };
}

async function saveSettings(): Promise<void> {
  const config = currentConfig();
  const rememberKey = rememberKeyInput.checked;
  const settings: StoredSettings = {
    baseUrl: config.baseUrl,
    model: config.model,
    rememberKey,
  };
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  if (rememberKey) {
    await chrome.storage.local.set({ [API_KEY]: config.apiKey });
    await chrome.storage.session.remove(API_KEY);
  } else {
    await chrome.storage.session.set({ [API_KEY]: config.apiKey });
    await chrome.storage.local.remove(API_KEY);
  }
}

async function loadSettings(): Promise<void> {
  const local = await chrome.storage.local.get([SETTINGS_KEY, API_KEY]);
  const settings = (local[SETTINGS_KEY] as StoredSettings | undefined) ?? {};
  const rememberKey = settings.rememberKey === true;
  const session = rememberKey ? {} : await chrome.storage.session.get(API_KEY);
  baseUrlInput.value = settings.baseUrl ?? DEFAULT_BASE_URL;
  modelInput.value = settings.model ?? DEFAULT_MODEL;
  rememberKeyInput.checked = rememberKey;
  apiKeyInput.value = String(
    rememberKey ? (local[API_KEY] ?? '') : (session[API_KEY] ?? ''),
  );
}

async function approveTool(
  name: string,
  args: Record<string, unknown>,
  tab: chrome.tabs.Tab,
): Promise<boolean> {
  if (READ_ONLY_TOOLS.has(name)) return true;
  const page = tab?.url ? new URL(tab.url).origin : 'the active tab';
  return window.confirm(
    `Allow Qwen Browser Agent to run ${name} on ${page}?\n\n${JSON.stringify(args, null, 2)}`,
  );
}

settingsForm.addEventListener('submit', (event) => {
  event.preventDefault();
  settingsStatus.textContent = 'Saving…';
  void saveSettings()
    .then(() => {
      settingsStatus.textContent = 'Saved';
      settingsPanel.open = false;
    })
    .catch((error: unknown) => {
      settingsStatus.textContent = `Error: ${
        error instanceof Error ? error.message : String(error)
      }`;
    });
});

composer.addEventListener('submit', (event) => {
  event.preventDefault();
  const prompt = promptInput.value.trim();
  if (!prompt || controller) return;

  let config: ModelConfig;
  try {
    config = currentConfig();
  } catch (error) {
    settingsPanel.open = true;
    appendMessage(
      'error',
      error instanceof Error ? error.message : String(error),
    );
    return;
  }

  appendMessage('user', prompt);
  promptInput.value = '';
  runStatus.textContent = 'Thinking…';
  setBusy(true);
  controller = new AbortController();
  const nextMessages: ChatMessage[] = [
    ...messages,
    { role: 'user', content: prompt },
  ];
  messages = nextMessages;

  void (async () => {
    try {
      const result = await runAgent({
        config,
        messages: nextMessages,
        tools,
        callTool: (name, args) => browserTools.callTool(name, args),
        signal: controller!.signal,
        onTool: (name, args) => {
          runStatus.textContent = `Reviewing ${name}…`;
          appendTool(name, args);
        },
      });
      messages = result.messages;
      appendMessage('assistant', result.text);
      runStatus.textContent = 'Ready';
    } catch (error) {
      const aborted =
        error instanceof DOMException && error.name === 'AbortError';
      appendMessage(
        'error',
        aborted
          ? 'Stopped.'
          : error instanceof Error
            ? error.message
            : String(error),
      );
      runStatus.textContent = aborted ? 'Stopped' : 'Request failed';
    } finally {
      await browserTools.shutdown().catch(() => undefined);
      controller = null;
      setBusy(false);
      promptInput.focus();
    }
  })();
});

stopButton.addEventListener('click', () => controller?.abort());

clearButton.addEventListener('click', () => {
  messages = [];
  for (const node of messagesElement.querySelectorAll(
    '.message, .tool-event',
  )) {
    node.remove();
  }
  welcomeElement.classList.remove('hidden');
  runStatus.textContent = 'Ready';
  void browserTools.shutdown().catch(() => undefined);
});

window.addEventListener('unload', () => browserSession.detachImmediately());

void loadSettings().catch((error: unknown) => {
  settingsStatus.textContent =
    error instanceof Error ? error.message : String(error);
});
