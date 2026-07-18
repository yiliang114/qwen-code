/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  DaemonEvent,
  DaemonTransport,
  DaemonTransportSubscribeOptions,
  PermissionResponse,
  PromptRequest,
} from '@qwen-code/sdk/daemon';
import {
  BrowserTools,
  sanitizeBrowserToolValue,
} from './background/browser-mcp/browser-tools.js';
import { ChromeDebuggerSession } from './background/browser-mcp/debugger-session.js';
import type { BrowserToolResult } from './background/browser-mcp/server.js';
import {
  runAgent,
  type ChatMessage,
  type ModelConfig,
} from './standalone-agent.js';

const STORAGE_KEY = 'qwen.standalone.sessions';
const WORKSPACE_CWD = '/browser';
const READ_ONLY_TOOLS = new Set([
  'take_snapshot',
  'take_screenshot',
  'wait_for',
  'list_console_messages',
  'get_console_message',
  'list_network_requests',
  'get_network_request',
]);

interface StoredSession {
  id: string;
  createdAt: string;
  updatedAt: string;
  displayName?: string;
  isArchived?: boolean;
  messages: ChatMessage[];
  events: DaemonEvent[];
}

interface PermissionWaiter {
  sessionId: string;
  resolve: (allowed: boolean) => void;
}

interface Subscriber {
  queue: DaemonEvent[];
  wake?: () => void;
}

export interface StandaloneTransportOptions {
  getConfig(): Promise<ModelConfig>;
  setModel(model: string): Promise<void>;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function body(init: RequestInit): Record<string, unknown> {
  if (typeof init.body !== 'string') return {};
  try {
    const value = JSON.parse(init.body) as unknown;
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function promptText(request: Record<string, unknown>): string {
  const blocks = Array.isArray(request['prompt']) ? request['prompt'] : [];
  return blocks
    .map((block) => {
      if (!block || typeof block !== 'object') return '';
      const value = block as Record<string, unknown>;
      return value['type'] === 'text' && typeof value['text'] === 'string'
        ? value['text']
        : '';
    })
    .filter(Boolean)
    .join('\n');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class StandaloneDaemonTransport implements DaemonTransport {
  readonly type = 'rest';
  readonly supportsReplay = true;
  readonly restFetch: typeof globalThis.fetch = (input, init) =>
    this.fetch(
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
      init ?? {},
    );
  connected = true;

  private readonly debuggerSession = new ChromeDebuggerSession();
  private readonly browserTools = new BrowserTools(
    this.debuggerSession,
    true,
    (name, args, tab) =>
      READ_ONLY_TOOLS.has(name)
        ? true
        : this.requestPermission(name, args, tab),
  );
  private readonly sessions = new Map<string, StoredSession>();
  private readonly subscribers = new Map<string, Set<Subscriber>>();
  private readonly permissions = new Map<string, PermissionWaiter>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly ready: Promise<void>;
  private eventId = 0;
  private activeSessionId?: string;
  private activeToolCallId?: string;

  constructor(private readonly options: StandaloneTransportOptions) {
    this.ready = this.load();
  }

  async fetch(url: string, init: RequestInit): Promise<Response> {
    await this.ready;
    if (!this.connected) return json({ error: 'Transport closed' }, 503);
    const parsed = new URL(url);
    const path = parsed.pathname;
    const method = init.method ?? 'GET';
    const requestBody = body(init);
    const workspacePath = path.match(/^\/workspaces\/[^/]+(\/.*)?$/)?.[1];

    if (method === 'GET' && path === '/capabilities') {
      return json({
        v: 1,
        mode: 'http-bridge',
        features: [
          'session_events',
          'permission_vote',
          'session_permission_vote',
          'client_heartbeat',
        ],
        modelServices: ['modelstudio'],
        transports: ['rest-sse'],
        workspaceCwd: WORKSPACE_CWD,
        qwenCodeVersion: chrome.runtime.getManifest().version,
      });
    }
    if (
      method === 'GET' &&
      (path === '/workspace/providers' || workspacePath === '/providers')
    ) {
      return json(await this.providers());
    }
    if (
      method === 'GET' &&
      (path === '/workspace/skills' || workspacePath === '/skills')
    ) {
      return json({
        v: 1,
        workspaceCwd: WORKSPACE_CWD,
        initialized: true,
        skills: [
          {
            name: 'browser',
            description:
              'Inspect and operate the active Chrome tab using browser tools.',
            status: 'ok',
          },
        ],
      });
    }
    if (method === 'GET' && path === '/workspace/acp/status') {
      return json({ v: 1, channelLive: true });
    }
    if (
      method === 'GET' &&
      (path === '/workspace/git' || workspacePath === '/git')
    ) {
      return json({ v: 1, workspaceCwd: WORKSPACE_CWD });
    }
    if (
      method === 'GET' &&
      (path === '/workspace/tools' || workspacePath === '/tools')
    ) {
      return json({
        v: 1,
        workspaceCwd: WORKSPACE_CWD,
        initialized: true,
        tools: this.browserTools.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          status: 'ok',
          source: 'browser',
        })),
      });
    }
    if (
      method === 'GET' &&
      (/^\/workspace\/[^/]+\/sessions\/?$/.test(path) ||
        workspacePath === '/sessions')
    ) {
      const archived = parsed.searchParams.get('archiveState') === 'archived';
      return json({
        sessions: [...this.sessions.values()]
          .filter((session) => (session.isArchived === true) === archived)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .map((session) => this.sessionSummary(session)),
      });
    }
    const batchAction =
      path.match(
        /^\/workspace\/[^/]+\/sessions\/(delete|archive|unarchive)\/?$/,
      ) ??
      workspacePath?.match(/^\/sessions\/(delete|archive|unarchive)\/?$/) ??
      path.match(/^\/sessions\/(delete|archive|unarchive)\/?$/);
    if (method === 'POST' && batchAction) {
      return this.batchSessions(
        batchAction[1] as 'delete' | 'archive' | 'unarchive',
        requestBody,
      );
    }
    if (
      method === 'GET' &&
      (/^\/workspace\/[^/]+\/session-groups\/?$/.test(path) ||
        workspacePath === '/session-groups')
    ) {
      return json({
        groups: [],
        colorOptions: ['red', 'orange', 'yellow', 'green', 'blue', 'purple'],
      });
    }
    if (method === 'GET' && workspacePath === '/mcp') {
      return json({
        v: 1,
        workspaceCwd: WORKSPACE_CWD,
        initialized: true,
        servers: [],
      });
    }
    if (method === 'GET' && workspacePath === '/memory') {
      return json({
        v: 1,
        workspaceCwd: WORKSPACE_CWD,
        initialized: true,
        files: [],
      });
    }
    if (method === 'GET' && workspacePath === '/agents') {
      return json({ v: 1, workspaceCwd: WORKSPACE_CWD, agents: [] });
    }
    if (method === 'GET' && workspacePath === '/extensions') {
      return json({ v: 1, workspaceCwd: WORKSPACE_CWD, extensions: [] });
    }
    if (method === 'POST' && path === '/session') {
      const session = this.createSession();
      return json(this.sessionEnvelope(session, false));
    }
    if (
      method === 'POST' &&
      /^\/session\/[^/]+\/permission\/[^/]+\/?$/.test(path)
    ) {
      const parts = path.split('/');
      return this.resolvePermission(
        decodeURIComponent(parts[2] ?? ''),
        decodeURIComponent(parts[4] ?? ''),
        requestBody as unknown as PermissionResponse,
      );
    }

    const match = path.match(/^\/session\/([^/]+)\/([^/]+)(?:\/([^/]+))?\/?$/);
    if (!match)
      return json({ error: `Unsupported route: ${method} ${path}` }, 404);
    const sessionId = decodeURIComponent(match[1] ?? '');
    const action = match[2];
    const session = this.sessions.get(sessionId);
    if (!session) return json({ error: 'Session not found' }, 404);

    if (method === 'POST' && (action === 'load' || action === 'resume')) {
      return json({
        ...this.sessionEnvelope(session, true),
        state: await this.sessionState(),
        compactedReplay: session.events,
        liveJournal: [],
        lastEventId: this.maxEventId(session.events),
      });
    }
    if (method === 'PATCH' && action === 'metadata') {
      const displayName = requestBody['displayName'];
      session.displayName =
        typeof displayName === 'string' && displayName.trim()
          ? displayName.trim()
          : undefined;
      session.updatedAt = new Date().toISOString();
      await this.persist();
      return json(
        session.displayName ? { displayName: session.displayName } : {},
      );
    }
    if (method === 'GET' && action === 'context') {
      return json({
        v: 1,
        sessionId,
        workspaceCwd: WORKSPACE_CWD,
        state: await this.sessionState(),
      });
    }
    if (method === 'GET' && action === 'supported-commands') {
      return json({
        v: 1,
        sessionId,
        availableCommands: [],
        availableSkills: [
          {
            name: 'browser',
            description: 'Operate the active Chrome tab.',
          },
        ],
      });
    }
    if (method === 'POST' && action === 'prompt') {
      const promptId =
        typeof (requestBody['_meta'] as Record<string, unknown> | undefined)?.[
          'promptId'
        ] === 'string'
          ? String(
              (requestBody['_meta'] as Record<string, unknown>)['promptId'],
            )
          : crypto.randomUUID();
      this.activeSessionId = sessionId;
      void this.runPrompt(
        session,
        requestBody as unknown as PromptRequest,
        promptId,
        new Headers(init.headers).get('X-Qwen-Client-Id') ?? undefined,
      );
      return json(
        { promptId, lastEventId: this.maxEventId(session.events) },
        202,
      );
    }
    if (method === 'POST' && action === 'model') {
      const modelId = requestBody['modelId'];
      if (typeof modelId !== 'string' || !modelId.trim()) {
        return json({ error: 'Invalid model' }, 400);
      }
      await this.options.setModel(modelId.trim());
      return json({ sessionId, modelId: modelId.trim() });
    }
    if (method === 'POST' && action === 'approval-mode') {
      return json({
        sessionId,
        previous: 'default',
        mode: requestBody['mode'] ?? 'default',
        persisted: false,
      });
    }
    if (method === 'POST' && action === 'heartbeat') {
      return json({ sessionId, lastSeenAt: Date.now() });
    }
    if (method === 'POST' && action === 'cancel') {
      this.controllers
        .get(sessionId)
        ?.abort(new DOMException('Stopped by user', 'AbortError'));
      this.cancelPermissions(session);
      return json({});
    }
    if (method === 'POST' && action === 'detach') {
      return new Response(null, { status: 204 });
    }
    if (method === 'GET' && action === 'pending-prompts') {
      return json({ pendingPrompts: [] });
    }
    return json({ error: `Unsupported route: ${method} ${path}` }, 404);
  }

  async *subscribeEvents(
    sessionId: string,
    options: DaemonTransportSubscribeOptions,
  ): AsyncGenerator<DaemonEvent> {
    await this.ready;
    const subscriber: Subscriber = { queue: [] };
    const set = this.subscribers.get(sessionId) ?? new Set<Subscriber>();
    set.add(subscriber);
    this.subscribers.set(sessionId, set);
    const replay = this.sessions
      .get(sessionId)
      ?.events.filter((event) => (event.id ?? 0) > (options.lastEventId ?? 0));
    subscriber.queue.push(...(replay ?? []));

    try {
      while (!options.signal?.aborted && this.connected) {
        const event = subscriber.queue.shift();
        if (event) {
          yield event;
          continue;
        }
        await new Promise<void>((resolve) => {
          subscriber.wake = resolve;
          options.signal?.addEventListener('abort', () => resolve(), {
            once: true,
          });
        });
        subscriber.wake = undefined;
      }
    } finally {
      set.delete(subscriber);
      if (set.size === 0) this.subscribers.delete(sessionId);
    }
  }

  dispose(): void {
    this.connected = false;
    this.controllers.forEach((controller) => controller.abort());
    this.subscribers.forEach((subscribers) =>
      subscribers.forEach((subscriber) => subscriber.wake?.()),
    );
    this.permissions.forEach((permission) => permission.resolve(false));
    void this.browserTools.shutdown().catch(() => undefined);
  }

  private async load(): Promise<void> {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const sessions = stored[STORAGE_KEY];
    if (!Array.isArray(sessions)) return;
    for (const value of sessions) {
      if (!value || typeof value !== 'object') continue;
      const session = value as StoredSession;
      if (typeof session.id !== 'string') continue;
      session.events = Array.isArray(session.events) ? session.events : [];
      session.messages = Array.isArray(session.messages)
        ? session.messages
        : [];
      this.sessions.set(session.id, session);
      this.eventId = Math.max(this.eventId, this.maxEventId(session.events));
    }
  }

  private async persist(): Promise<void> {
    await chrome.storage.local.set({
      [STORAGE_KEY]: [...this.sessions.values()]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 20)
        .map((session) => ({
          ...session,
          messages: session.messages.slice(-100).map((message) => ({
            ...message,
            content:
              typeof message.content === 'string'
                ? message.content.slice(0, 65_536)
                : null,
            tool_calls: message.tool_calls?.map((call) => ({
              ...call,
              function: {
                ...call.function,
                arguments: call.function.arguments.slice(0, 65_536),
              },
            })),
          })),
          events: session.events.slice(-500),
        })),
    });
  }

  private createSession(): StoredSession {
    const now = new Date().toISOString();
    const session: StoredSession = {
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      messages: [],
      events: [],
    };
    this.sessions.set(session.id, session);
    void this.persist();
    return session;
  }

  private sessionEnvelope(session: StoredSession, attached: boolean) {
    return {
      sessionId: session.id,
      workspaceCwd: WORKSPACE_CWD,
      attached,
      clientId: `chrome-${session.id}`,
      createdAt: session.createdAt,
      hasActivePrompt: this.controllers.has(session.id),
    };
  }

  private sessionSummary(session: StoredSession) {
    const firstUser = session.messages.find(
      (message) => message.role === 'user',
    );
    return {
      sessionId: session.id,
      workspaceCwd: WORKSPACE_CWD,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      displayName:
        session.displayName ??
        (typeof firstUser?.content === 'string'
          ? firstUser.content.slice(0, 80)
          : 'New browser chat'),
      clientCount: 1,
      hasActivePrompt: this.controllers.has(session.id),
      isArchived: session.isArchived === true,
    };
  }

  private async batchSessions(
    action: 'delete' | 'archive' | 'unarchive',
    request: Record<string, unknown>,
  ): Promise<Response> {
    const ids = Array.isArray(request['sessionIds'])
      ? request['sessionIds'].filter(
          (value): value is string => typeof value === 'string',
        )
      : [];
    const changed: string[] = [];
    const unchanged: string[] = [];
    const notFound: string[] = [];
    for (const id of ids) {
      const session = this.sessions.get(id);
      if (!session) {
        notFound.push(id);
      } else if (action === 'delete') {
        this.sessions.delete(id);
        changed.push(id);
      } else {
        const archived = action === 'archive';
        if ((session.isArchived === true) === archived) {
          unchanged.push(id);
        } else {
          session.isArchived = archived;
          session.updatedAt = new Date().toISOString();
          changed.push(id);
        }
      }
    }
    await this.persist();
    if (action === 'delete') {
      return json({ removed: changed, notFound, errors: [] });
    }
    if (action === 'archive') {
      return json({
        archived: changed,
        alreadyArchived: unchanged,
        notFound,
        errors: [],
      });
    }
    return json({
      unarchived: changed,
      alreadyActive: unchanged,
      notFound,
      errors: [],
    });
  }

  private async providers() {
    const config = await this.options.getConfig();
    return {
      v: 1,
      workspaceCwd: WORKSPACE_CWD,
      initialized: true,
      acpChannelLive: true,
      approvalMode: 'default',
      current: {
        authType: 'api-key',
        modelId: config.model,
        fastModelId: config.model,
      },
      providers: [
        {
          kind: 'model_provider',
          status: 'ok',
          authType: 'api-key',
          current: true,
          models: [
            {
              modelId: config.model,
              baseModelId: config.model,
              name: config.model,
              isCurrent: true,
              isRuntime: true,
            },
          ],
        },
      ],
    };
  }

  private async sessionState() {
    const config = await this.options.getConfig();
    return {
      models: {
        currentModelId: config.model,
        availableModels: [
          {
            modelId: config.model,
            baseModelId: config.model,
            name: config.model,
          },
        ],
      },
      modes: { currentModeId: 'default' },
    };
  }

  private emit(
    session: StoredSession,
    type: DaemonEvent['type'],
    data: Record<string, unknown>,
    originatorClientId?: string,
  ): void {
    const event = {
      id: ++this.eventId,
      v: 1,
      type,
      data,
      ...(originatorClientId ? { originatorClientId } : {}),
    } as DaemonEvent;
    session.events.push(event);
    session.events = session.events.slice(-500);
    for (const subscriber of this.subscribers.get(session.id) ?? []) {
      subscriber.queue.push(event);
      subscriber.wake?.();
    }
  }

  private emitUpdate(
    session: StoredSession,
    update: Record<string, unknown>,
    originatorClientId?: string,
  ): void {
    this.emit(session, 'session_update', { update }, originatorClientId);
  }

  private async runPrompt(
    session: StoredSession,
    request: PromptRequest,
    promptId: string,
    clientId?: string,
  ): Promise<void> {
    const text = promptText(request as unknown as Record<string, unknown>);
    const controller = new AbortController();
    this.controllers.set(session.id, controller);
    session.messages.push({ role: 'user', content: text });
    this.emitUpdate(
      session,
      {
        sessionUpdate: 'user_message_chunk',
        content: { type: 'text', text },
      },
      clientId,
    );

    try {
      const result = await runAgent({
        config: await this.options.getConfig(),
        messages: session.messages,
        tools: this.browserTools.tools,
        callTool: (name, args) => this.browserTools.callTool(name, args),
        signal: controller.signal,
        onTool: (name, args, toolCallId) => {
          this.activeToolCallId = toolCallId;
          this.emitUpdate(session, {
            sessionUpdate: 'tool_call',
            toolCallId,
            title: name,
            name,
            status: 'running',
            rawInput: sanitizeBrowserToolValue(args),
            provenance: 'builtin',
          });
        },
        onToolResult: (name, _args, toolResult, toolCallId) => {
          this.emitToolResult(session, name, toolCallId, toolResult);
          this.activeToolCallId = undefined;
        },
      });
      session.messages = result.messages;
      this.emitUpdate(session, {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: result.text },
      });
      this.emit(session, 'turn_complete', {
        promptId,
        sessionId: session.id,
        stopReason: 'end_turn',
      });
    } catch (error) {
      if (controller.signal.aborted) {
        this.emit(session, 'turn_complete', {
          promptId,
          sessionId: session.id,
          stopReason: 'cancelled',
        });
      } else {
        this.emit(session, 'turn_error', {
          promptId,
          sessionId: session.id,
          error: errorMessage(error),
        });
      }
    } finally {
      this.activeToolCallId = undefined;
      this.controllers.delete(session.id);
      session.updatedAt = new Date().toISOString();
      await this.browserTools.shutdown().catch(() => undefined);
      await this.persist();
    }
  }

  private emitToolResult(
    session: StoredSession,
    name: string,
    toolCallId: string,
    result: BrowserToolResult,
  ): void {
    const output = result.content
      .map((item) =>
        item.type === 'text'
          ? item.text
          : `[${item.mimeType} screenshot captured]`,
      )
      .join('\n')
      .slice(0, 65_536);
    this.emitUpdate(session, {
      sessionUpdate: 'tool_call_update',
      toolCallId,
      title: name,
      name,
      status: result.isError ? 'failed' : 'completed',
      rawOutput: output,
    });
  }

  private requestPermission(
    name: string,
    args: Record<string, unknown>,
    tab: chrome.tabs.Tab,
  ): Promise<boolean> {
    const sessionId = this.activeSessionId;
    const session = sessionId ? this.sessions.get(sessionId) : undefined;
    if (!session || !sessionId) return Promise.resolve(false);
    const requestId = crypto.randomUUID();
    this.emit(session, 'permission_request', {
      requestId,
      sessionId,
      toolCall: {
        toolCallId: this.activeToolCallId ?? requestId,
        title: name,
        name,
        status: 'pending',
        rawInput: { ...args, url: tab.url },
      },
      options: [
        {
          optionId: 'allow_once',
          name: 'Allow once',
          kind: 'allow_once',
        },
        {
          optionId: 'reject_once',
          name: 'Reject',
          kind: 'reject_once',
        },
      ],
    });
    return new Promise<boolean>((resolve) => {
      this.permissions.set(requestId, { sessionId, resolve });
    });
  }

  private resolvePermission(
    sessionId: string,
    requestId: string,
    response: PermissionResponse,
  ): Response {
    const pending = this.permissions.get(requestId);
    if (!pending || pending.sessionId !== sessionId) return json({}, 404);
    this.permissions.delete(requestId);
    const optionId =
      response.outcome.outcome === 'selected'
        ? response.outcome.optionId
        : 'reject_once';
    pending.resolve(optionId === 'allow_once');
    const session = this.sessions.get(sessionId);
    if (session) {
      this.emit(session, 'permission_resolved', {
        requestId,
        outcome: { outcome: 'selected', optionId },
      });
    }
    return json({});
  }

  private cancelPermissions(session: StoredSession): void {
    for (const [requestId, pending] of this.permissions) {
      if (pending.sessionId !== session.id) continue;
      this.permissions.delete(requestId);
      pending.resolve(false);
      this.emit(session, 'permission_resolved', {
        requestId,
        outcome: { outcome: 'cancelled' },
      });
    }
  }

  private maxEventId(events: readonly DaemonEvent[]): number {
    return events.reduce((max, event) => Math.max(max, event.id ?? 0), 0);
  }
}
