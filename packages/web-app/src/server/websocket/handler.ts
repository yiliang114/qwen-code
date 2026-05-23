/**
 * @license
 * Copyright 2025 Qwen Code Team
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WebSocket, WebSocketServer } from 'ws';
import type { WSMessage } from '../../shared/types.js';
import type { SecureSessionManager } from '../sessionManager.js';
import { sessionManager } from '../sessionManager.js';
import { JwtService, SessionStore } from '../auth/index.js';

/**
 * WebSocket client state with authentication
 */
interface ClientState {
  sessionId: string | null;
  userId: string | null;
  username: string | null;
  isAuthenticated: boolean;
  sessionManager: SecureSessionManager;
}

/**
 * Parse authentication token from WebSocket connection
 */
function parseAuthFromUrl(
  url: string,
): { sessionId?: string; token?: string } | null {
  try {
    const urlObj = new URL(url, 'http://localhost');
    const sessionId = urlObj.searchParams.get('sessionId') || undefined;
    const token = urlObj.searchParams.get('token') || undefined;
    return { sessionId, token };
  } catch {
    return null;
  }
}

/**
 * Setup WebSocket server with authentication and session isolation
 */
export function setupWebSocket(wss: WebSocketServer) {
  const clientStates = new WeakMap<WebSocket, ClientState>();

  wss.on(
    'connection',
    (
      ws: WebSocket,
      req: { url?: string; headers?: Record<string, string> },
    ) => {
      // Extract auth from URL params or headers
      const urlAuth = req.url ? parseAuthFromUrl(req.url) : null;
      const authHeader = req.headers?.['authorization'] as string | undefined;
      const sessionIdHeader = req.headers?.['x-session-id'] as
        | string
        | undefined;

      let userId: string | null = null;
      let username: string | null = null;
      let isAuthenticated = false;

      // Try to authenticate via JWT
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        const payload = JwtService.verify(token);
        if (payload) {
          userId = payload.userId;
          username = payload.username;
          isAuthenticated = true;
        }
      }

      // Or via session
      if (!isAuthenticated && sessionIdHeader) {
        const session = SessionStore.getSession(sessionIdHeader);
        if (session) {
          userId = session.userId;
          username = session.username;
          isAuthenticated = true;
        }
      }

      console.log(
        `WebSocket client connected - Authenticated: ${isAuthenticated}`,
      );

      // Initialize client state
      clientStates.set(ws, {
        sessionId: urlAuth?.sessionId || null,
        userId,
        username,
        isAuthenticated,
        sessionManager,
      });

      // Send connection status
      ws.send(
        JSON.stringify({
          type: 'connected',
          authenticated: isAuthenticated,
          username: username || 'anonymous',
        }),
      );

      ws.on('message', async (data) => {
        try {
          const message: WSMessage = JSON.parse(data.toString());
          const state = clientStates.get(ws);
          if (!state) {
            return;
          }

          switch (message.type) {
            case 'auth':
              await handleAuth(ws, state, message);
              break;
            case 'join_session':
              await handleJoinSession(ws, state, message);
              break;
            case 'leave_session':
              handleLeaveSession(ws, state);
              break;
            case 'create_session':
              await handleCreateSession(ws, state);
              break;
            case 'user_message':
              await handleUserMessage(ws, state, message);
              break;
            case 'cancel':
              handleCancel(state);
              break;
            case 'permission_response':
              handlePermissionResponse(state, message);
              break;
            default:
              ws.send(
                JSON.stringify({
                  type: 'error',
                  message: `Unknown message type: ${message.type}`,
                }),
              );
          }
        } catch (error) {
          console.error('WebSocket message error:', error);
          ws.send(
            JSON.stringify({
              type: 'error',
              message: error instanceof Error ? error.message : 'Unknown error',
            }),
          );
        }
      });

      ws.on('close', () => {
        console.log('WebSocket client disconnected');
        const state = clientStates.get(ws);
        if (state?.sessionId) {
          // Don't remove session on disconnect - let idle cleanup handle it
          const session = sessionManager.getSession(state.sessionId);
          if (session) {
            session.runner.removeClient(ws);
          }
        }
        clientStates.delete(ws);
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
      });
    },
  );
}

/**
 * Handle authentication message
 */
async function handleAuth(
  ws: WebSocket,
  state: ClientState,
  message: WSMessage,
): Promise<void> {
  const { token } = message as { token?: string };

  if (!token) {
    ws.send(
      JSON.stringify({
        type: 'auth_error',
        message: 'Token required',
      }),
    );
    return;
  }

  const payload = JwtService.verify(token);
  if (!payload) {
    ws.send(
      JSON.stringify({
        type: 'auth_error',
        message: 'Invalid or expired token',
      }),
    );
    return;
  }

  state.userId = payload.userId;
  state.username = payload.username;
  state.isAuthenticated = true;

  ws.send(
    JSON.stringify({
      type: 'auth_success',
      userId: payload.userId,
      username: payload.username,
    }),
  );

  console.log(`WebSocket user authenticated: ${payload.username}`);
}

/**
 * Handle join session request with ownership verification
 */
async function handleJoinSession(
  ws: WebSocket,
  state: ClientState,
  message: WSMessage,
): Promise<void> {
  const sessionId = message.sessionId as string;

  if (!sessionId) {
    ws.send(JSON.stringify({ type: 'error', message: 'Session ID required' }));
    return;
  }

  // Leave previous session if any
  if (state.sessionId) {
    const prevSession = sessionManager.getSession(
      state.sessionId,
      state.userId || undefined,
    );
    if (prevSession) {
      prevSession.runner.removeClient(ws);
    }
  }

  // Get session with ownership check
  const session = sessionManager.getSession(
    sessionId,
    state.isAuthenticated ? state.userId : undefined,
  );

  if (!session) {
    ws.send(
      JSON.stringify({
        type: 'error',
        message: state.isAuthenticated
          ? 'Session not found'
          : 'Authentication required',
      }),
    );
    state.sessionId = null;
    return;
  }

  state.sessionId = sessionId;
  session.runner.addClient(ws);

  // Load and send history
  try {
    const history = await session.runner.getHistory();
    ws.send(JSON.stringify({ type: 'history', messages: history }));
  } catch (error) {
    console.error('Error loading session history:', error);
    ws.send(JSON.stringify({ type: 'history', messages: [] }));
  }

  ws.send(
    JSON.stringify({
      type: 'joined',
      sessionId,
      message: `Joined session ${sessionId}`,
    }),
  );
}

/**
 * Handle create session request
 */
async function handleCreateSession(
  ws: WebSocket,
  state: ClientState,
): Promise<void> {
  if (!state.isAuthenticated) {
    ws.send(
      JSON.stringify({
        type: 'error',
        message: 'Authentication required to create session',
      }),
    );
    return;
  }

  try {
    const cwd = process.cwd();
    const session = await sessionManager.createSession(
      state.userId!,
      state.username!,
      cwd,
    );

    state.sessionId = session.id;
    session.runner.addClient(ws);

    ws.send(
      JSON.stringify({
        type: 'session_created',
        sessionId: session.id,
        message: `Created new session ${session.id}`,
      }),
    );
  } catch (error) {
    console.error('Error creating session:', error);
    ws.send(
      JSON.stringify({
        type: 'error',
        message:
          error instanceof Error ? error.message : 'Failed to create session',
      }),
    );
  }
}

/**
 * Handle leave session request
 */
function handleLeaveSession(ws: WebSocket, state: ClientState): void {
  if (!state.sessionId) {
    return;
  }

  const session = sessionManager.getSession(
    state.sessionId,
    state.userId || undefined,
  );
  if (session) {
    session.runner.removeClient(ws);
  }

  state.sessionId = null;
}

/**
 * Handle user message with session ownership check
 */
async function handleUserMessage(
  ws: WebSocket,
  state: ClientState,
  message: WSMessage,
): Promise<void> {
  if (!state.sessionId) {
    ws.send(JSON.stringify({ type: 'error', message: 'Not in a session' }));
    return;
  }

  const content = message.content as string;
  if (!content || !content.trim()) {
    ws.send(
      JSON.stringify({ type: 'error', message: 'Message content required' }),
    );
    return;
  }

  const session = sessionManager.getSession(
    state.sessionId,
    state.userId || undefined,
  );

  if (!session) {
    ws.send(
      JSON.stringify({
        type: 'error',
        message: 'Session not found or access denied',
      }),
    );
    return;
  }

  await session.runner.handleUserMessage(content.trim());
}

/**
 * Handle cancel request
 */
function handleCancel(state: ClientState): void {
  if (!state.sessionId) {
    return;
  }

  const session = sessionManager.getSession(
    state.sessionId,
    state.userId || undefined,
  );
  session?.runner.cancel();
}

/**
 * Handle permission response
 */
function handlePermissionResponse(
  state: ClientState,
  message: WSMessage,
): void {
  if (!state.sessionId) {
    return;
  }

  const session = sessionManager.getSession(
    state.sessionId,
    state.userId || undefined,
  );
  session?.runner.handlePermissionResponse({
    optionId: message.optionId as string,
    requestId: message.requestId as string | undefined,
  });
}
