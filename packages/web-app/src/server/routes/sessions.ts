/**
 * @license
 * Copyright 2025 Qwen Code Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { SessionService } from '@qwen-code/qwen-code-core';
import { sessionManager } from '../sessionManager.js';
import { authMiddleware } from '../middleware/security.js';

const cwd = process.cwd();
const sessionService = new SessionService(cwd);

/**
 * Create sessions router with authentication
 */
export function sessionsRouter() {
  const router = Router();

  /**
   * GET /api/sessions - List all sessions
   */
  router.get('/', authMiddleware, async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string, 10) || 50;

      // If authenticated, show user's sessions from session manager
      if (req.user) {
        const userSessions = sessionManager.getUserSessions(req.user.id);
        res.json({
          success: true,
          data: {
            sessions: userSessions.map((s) => ({
              id: s.id,
              title: 'Untitled Session',
              cwd: s.cwd,
              status: s.status,
              lastUpdated: s.lastActivity.toISOString(),
              createdAt: s.createdAt.toISOString(),
            })),
            hasMore: false,
          },
        });
        return;
      }

      // Fallback to legacy session listing
      const result = await sessionService.listSessions({ size: limit });

      res.json({
        success: true,
        data: {
          sessions: result.items.map((s) => ({
            id: s.sessionId,
            title: s.prompt || 'Untitled Session',
            lastUpdated: new Date(s.mtime).toISOString(),
            startTime: s.startTime,
          })),
          hasMore: result.hasMore,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error listing sessions:', message);

      // If configuration is not available, return empty list
      if (
        message.includes('Configuration not available') ||
        message.includes('not found')
      ) {
        return res.json({
          success: true,
          data: { sessions: [], hasMore: false },
        });
      }

      res.status(500).json({
        success: false,
        error: 'Failed to list sessions',
        message,
      });
    }
  });

  /**
   * POST /api/sessions - Create a new session
   */
  router.post('/', authMiddleware, async (req: Request, res: Response) => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
      return;
    }

    try {
      const { cwd: sessionCwd } = req.body;

      const session = await sessionManager.createSession(
        req.user.id,
        req.user.username,
        sessionCwd || cwd,
      );

      res.status(201).json({
        success: true,
        data: {
          sessionId: session.id,
          cwd: session.cwd,
          createdAt: session.createdAt.toISOString(),
        },
      });
    } catch (error) {
      console.error('Error creating session:', error);
      res.status(400).json({
        success: false,
        error:
          error instanceof Error ? error.message : 'Failed to create session',
      });
    }
  });

  /**
   * GET /api/sessions/:id - Get session details
   */
  router.get('/:id', authMiddleware, async (req: Request, res: Response) => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
      return;
    }

    try {
      const session = sessionManager.getSession(req.params.id, req.user.id);

      if (!session) {
        // Try legacy session service
        const legacySession = await sessionService.loadSession(req.params.id);
        if (!legacySession) {
          return res.status(404).json({
            success: false,
            error: 'Session not found',
          });
        }

        return res.json({
          success: true,
          data: {
            id: legacySession.conversation.sessionId,
            title: 'Untitled Session',
            messages: legacySession.conversation.messages,
            lastUpdated: legacySession.conversation.lastUpdated,
          },
        });
      }

      const history = await session.runner.getHistory();

      res.json({
        success: true,
        data: {
          id: session.id,
          cwd: session.cwd,
          status: session.status,
          history,
          createdAt: session.createdAt.toISOString(),
          lastActivity: session.lastActivity.toISOString(),
        },
      });
    } catch (error) {
      console.error('Error loading session:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to load session',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * DELETE /api/sessions/:id - Delete a session
   */
  router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
      return;
    }

    try {
      // Try to remove from session manager first
      const session = sessionManager.getSession(req.params.id, req.user.id);

      if (session) {
        await sessionManager.removeSession(req.params.id);
        return res.json({
          success: true,
          message: 'Session deleted successfully',
        });
      }

      // Fallback to legacy session service
      const success = await sessionService.removeSession(req.params.id);

      if (!success) {
        return res.status(404).json({
          success: false,
          error: 'Session not found',
        });
      }

      res.json({
        success: true,
        message: 'Session deleted successfully',
      });
    } catch (error) {
      console.error('Error deleting session:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete session',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/sessions/:id/history - Get session history
   */
  router.get(
    '/:id/history',
    authMiddleware,
    async (req: Request, res: Response) => {
      if (!req.user) {
        res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
        return;
      }

      try {
        const session = sessionManager.getSession(req.params.id, req.user.id);

        if (!session) {
          return res.status(404).json({
            success: false,
            error: 'Session not found',
          });
        }

        const history = await session.runner.getHistory();

        res.json({
          success: true,
          data: {
            history,
          },
        });
      } catch (error) {
        console.error('Error getting session history:', error);
        res.status(500).json({
          success: false,
          error: 'Failed to get session history',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    },
  );

  /**
   * GET /api/sessions/-/stats - Get session statistics
   */
  router.get('/-/stats', authMiddleware, (req: Request, res: Response) => {
    const stats = sessionManager.getStats();

    res.json({
      success: true,
      data: stats,
    });
  });

  return router;
}
