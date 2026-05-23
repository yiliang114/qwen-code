/**
 * @license
 * Copyright 2025 Qwen Code Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { SessionRunner } from './websocket/sessionRunner.js';
import { EventEmitter } from 'events';

/**
 * Session state
 */
export interface SessionState {
  id: string;
  userId: string;
  username: string;
  cwd: string;
  createdAt: Date;
  lastActivity: Date;
  status: 'idle' | 'running' | 'paused' | 'error';
  runner: SessionRunner;
}

/**
 * Session configuration
 */
export interface SessionConfig {
  maxSessionsPerUser: number;
  maxSessionDuration: number; // in milliseconds
  idleTimeout: number; // in milliseconds
  maxConcurrentSessions: number;
}

const DEFAULT_CONFIG: SessionConfig = {
  maxSessionsPerUser: 5,
  maxSessionDuration: 24 * 60 * 60 * 1000, // 24 hours
  idleTimeout: 2 * 60 * 60 * 1000, // 2 hours
  maxConcurrentSessions: 10,
};

/**
 * Secure Session Manager with isolation and resource control
 */
export class SecureSessionManager extends EventEmitter {
  private sessions = new Map<string, SessionState>();
  private userSessions = new Map<string, Set<string>>(); // userId -> sessionIds
  private config: SessionConfig;

  constructor(config: Partial<SessionConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Start cleanup interval
    setInterval(() => this.cleanupIdleSessions(), 5 * 60 * 1000); // Every 5 minutes
  }

  /**
   * Create a new session for a user
   */
  async createSession(
    userId: string,
    username: string,
    cwd: string = process.cwd(),
  ): Promise<SessionState> {
    // Check max concurrent sessions
    if (this.sessions.size >= this.config.maxConcurrentSessions) {
      throw new Error('Maximum concurrent sessions reached');
    }

    // Check user's session limit
    const userSessionIds = this.userSessions.get(userId) || new Set();
    if (userSessionIds.size >= this.config.maxSessionsPerUser) {
      this.emit('max-sessions-reached', userId);
      throw new Error(
        `Maximum ${this.config.maxSessionsPerUser} sessions per user`,
      );
    }

    // Create new session runner
    const runner = await SessionRunner.createNew(cwd);
    const sessionId = runner.getSessionId();

    // Create session state
    const now = new Date();
    const session: SessionState = {
      id: sessionId,
      userId,
      username,
      cwd,
      createdAt: now,
      lastActivity: now,
      status: 'idle',
      runner,
    };

    // Store session
    this.sessions.set(sessionId, session);
    userSessionIds.add(sessionId);
    this.userSessions.set(userId, userSessionIds);

    this.emit('created', session);

    return session;
  }

  /**
   * Get session by ID with ownership verification
   */
  getSession(sessionId: string, userId?: string): SessionState | undefined {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return undefined;
    }

    // Verify ownership if userId provided
    if (userId && session.userId !== userId) {
      return undefined; // Don't leak session info across users
    }

    // Update last activity
    session.lastActivity = new Date();
    this.emit('activity', sessionId);

    return session;
  }

  /**
   * Get or create session (lazy initialization)
   */
  async getOrCreateSession(
    sessionId: string,
    userId: string,
    username: string,
    cwd: string = process.cwd(),
  ): Promise<SessionState> {
    const existing = this.getSession(sessionId, userId);

    if (existing) {
      return existing;
    }

    // Create new session with the specified ID
    const runner = new SessionRunner(sessionId, cwd);
    const now = new Date();

    const session: SessionState = {
      id: sessionId,
      userId,
      username,
      cwd,
      createdAt: now,
      lastActivity: now,
      status: 'idle',
      runner,
    };

    this.sessions.set(sessionId, session);

    const userSessionIds = this.userSessions.get(userId) || new Set();
    userSessionIds.add(sessionId);
    this.userSessions.set(userId, userSessionIds);

    this.emit('created', session);

    return session;
  }

  /**
   * Remove session
   */
  async removeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return;
    }

    // Shutdown runner
    try {
      await session.runner.shutdown();
    } catch (error) {
      console.error(`Error shutting down session ${sessionId}:`, error);
    }

    // Remove from maps
    this.sessions.delete(sessionId);

    const userSessionIds = this.userSessions.get(session.userId);
    if (userSessionIds) {
      userSessionIds.delete(sessionId);
      if (userSessionIds.size === 0) {
        this.userSessions.delete(session.userId);
      }
    }

    this.emit('destroyed', sessionId);
  }

  /**
   * Remove all sessions for a user
   */
  async removeUserSessions(userId: string): Promise<void> {
    const sessionIds = this.userSessions.get(userId);

    if (!sessionIds) {
      return;
    }

    // Remove all sessions
    const promises = Array.from(sessionIds).map((id) => this.removeSession(id));
    await Promise.all(promises);

    this.userSessions.delete(userId);
  }

  /**
   * Get all sessions for a user
   */
  getUserSessions(userId: string): SessionState[] {
    const sessionIds = this.userSessions.get(userId);

    if (!sessionIds) {
      return [];
    }

    return Array.from(sessionIds)
      .map((id) => this.sessions.get(id))
      .filter((s): s is SessionState => s !== undefined);
  }

  /**
   * Get active sessions count
   */
  getActiveSessionsCount(): number {
    return this.sessions.size;
  }

  /**
   * Get sessions by status
   */
  getSessionsByStatus(status: SessionState['status']): SessionState[] {
    return Array.from(this.sessions.values()).filter(
      (s) => s.status === status,
    );
  }

  /**
   * Update session status
   */
  updateSessionStatus(sessionId: string, status: SessionState['status']): void {
    const session = this.sessions.get(sessionId);

    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    session.status = status;
    session.lastActivity = new Date();
  }

  /**
   * Cleanup idle sessions
   */
  private async cleanupIdleSessions(): Promise<void> {
    const now = Date.now();
    const idleSessions: string[] = [];

    for (const [id, session] of this.sessions.entries()) {
      const idleTime = now - session.lastActivity.getTime();

      if (idleTime > this.config.idleTimeout) {
        idleSessions.push(id);
      }
    }

    for (const sessionId of idleSessions) {
      console.log(`Cleaning up idle session: ${sessionId}`);
      await this.removeSession(sessionId);
    }
  }

  /**
   * Get session statistics
   */
  getStats(): {
    totalSessions: number;
    activeUsers: number;
    sessionsByStatus: Record<string, number>;
  } {
    const activeUsers = new Set(this.userSessions.keys());
    const sessionsByStatus: Record<string, number> = {};

    for (const session of this.sessions.values()) {
      sessionsByStatus[session.status] =
        (sessionsByStatus[session.status] || 0) + 1;
    }

    return {
      totalSessions: this.sessions.size,
      activeUsers: activeUsers.size,
      sessionsByStatus,
    };
  }

  /**
   * Shutdown all sessions
   */
  async shutdown(): Promise<void> {
    const promises = Array.from(this.sessions.keys()).map((id) =>
      this.removeSession(id),
    );
    await Promise.all(promises);

    this.sessions.clear();
    this.userSessions.clear();
    this.removeAllListeners();
  }
}

// Export singleton instance for backward compatibility
export const sessionManager = new SecureSessionManager();

// Re-export old API for backward compatibility
export async function createSession(
  cwd: string = process.cwd(),
): Promise<SessionRunner> {
  // For backward compatibility, create anonymous session
  const session = await sessionManager.createSession(
    'anonymous',
    'anonymous',
    cwd,
  );
  return session.runner;
}

export function getSession(sessionId: string): SessionRunner | undefined {
  const session = sessionManager.getSession(sessionId);
  return session?.runner;
}

export function getOrCreateSession(
  sessionId: string,
  cwd: string = process.cwd(),
): SessionRunner {
  const session = sessionManager.getSession(sessionId);
  if (session) {
    return session.runner;
  }
  // This is a simplified version, real implementation would need user context
  const newSession = new SessionRunner(sessionId, cwd);
  return newSession;
}

export async function removeSession(sessionId: string): Promise<void> {
  await sessionManager.removeSession(sessionId);
}

export function getActiveSessions(): string[] {
  return Array.from(sessionManager.sessions.keys());
}
