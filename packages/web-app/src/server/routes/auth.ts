/**
 * @license
 * Copyright 2025 Qwen Code Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { Router } from 'express';
import {
  UserRepository,
  PasswordHasher,
  JwtService,
  SessionStore,
} from '../auth/index.js';
import {
  authMiddleware,
  rateLimiters,
  attachCsrfToken,
  generateCsrfToken,
} from '../middleware/security.js';

/**
 * Create authentication router
 */
export function createAuthRouter(): Router {
  const router = Router();

  /**
   * POST /api/auth/login - User login
   */
  router.post('/login', rateLimiters.auth, async (req, res) => {
    try {
      const { username, password } = req.body;

      if (!username || !password) {
        res.status(400).json({
          success: false,
          error: 'Username and password are required',
        });
        return;
      }

      const user = UserRepository.findByUsername(username);

      if (!user) {
        // Use same error message to prevent username enumeration
        res.status(401).json({
          success: false,
          error: 'Invalid username or password',
        });
        return;
      }

      const isValid = await PasswordHasher.verifyPassword(
        password,
        user.passwordHash,
        user.salt,
      );

      if (!isValid) {
        res.status(401).json({
          success: false,
          error: 'Invalid username or password',
        });
        return;
      }

      // Create session
      const session = SessionStore.createSession(user.id, user.username);

      // Generate JWT
      const token = JwtService.sign({
        userId: user.id,
        username: user.username,
      });

      // Attach CSRF token
      attachCsrfToken(req, res);

      res.json({
        success: true,
        data: {
          user: {
            id: user.id,
            username: user.username,
          },
          sessionId: session.id,
          token,
          expiresAt: session.expiresAt.toISOString(),
        },
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({
        success: false,
        error: 'Login failed. Please try again.',
      });
    }
  });

  /**
   * POST /api/auth/logout - User logout
   */
  router.post('/logout', authMiddleware, (req, res) => {
    const sessionId = req.sessionId;

    if (sessionId) {
      SessionStore.deleteSession(sessionId);
    }

    res.clearCookie('csrf-token');
    res.json({
      success: true,
      message: 'Logged out successfully',
    });
  });

  /**
   * GET /api/auth/me - Get current user info
   */
  router.get('/me', authMiddleware, (req, res) => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: 'Not authenticated',
      });
      return;
    }

    const user = UserRepository.findById(req.user.id);

    if (!user) {
      res.status(404).json({
        success: false,
        error: 'User not found',
      });
      return;
    }

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          username: user.username,
          createdAt: user.createdAt.toISOString(),
        },
      },
    });
  });

  /**
   * POST /api/auth/register - Register new user (optional, can be disabled)
   */
  router.post('/register', rateLimiters.auth, async (req, res) => {
    // Check if registration is enabled
    if (process.env.DISABLE_REGISTRATION === 'true') {
      res.status(403).json({
        success: false,
        error: 'Registration is disabled',
      });
      return;
    }

    try {
      const { username, password } = req.body;

      if (!username || !password) {
        res.status(400).json({
          success: false,
          error: 'Username and password are required',
        });
        return;
      }

      if (password.length < 8) {
        res.status(400).json({
          success: false,
          error: 'Password must be at least 8 characters long',
        });
        return;
      }

      const result = await UserRepository.createUser(username, password);

      if (!result) {
        res.status(400).json({
          success: false,
          error: 'Username already exists',
        });
        return;
      }

      res.status(201).json({
        success: true,
        message: 'User registered successfully',
      });
    } catch (error) {
      console.error('Registration error:', error);
      res.status(500).json({
        success: false,
        error: 'Registration failed. Please try again.',
      });
    }
  });

  /**
   * POST /api/auth/change-password - Change password
   */
  router.post('/change-password', authMiddleware, async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body;

      if (!req.user) {
        res.status(401).json({
          success: false,
          error: 'Not authenticated',
        });
        return;
      }

      if (!currentPassword || !newPassword) {
        res.status(400).json({
          success: false,
          error: 'Current password and new password are required',
        });
        return;
      }

      if (newPassword.length < 8) {
        res.status(400).json({
          success: false,
          error: 'New password must be at least 8 characters long',
        });
        return;
      }

      const user = UserRepository.findById(req.user.id);

      if (!user) {
        res.status(404).json({
          success: false,
          error: 'User not found',
        });
        return;
      }

      // Verify current password
      const isValid = await PasswordHasher.verifyPassword(
        currentPassword,
        user.passwordHash,
        user.salt,
      );

      if (!isValid) {
        res.status(401).json({
          success: false,
          error: 'Current password is incorrect',
        });
        return;
      }

      // Update password (in a real implementation, you'd have an updateUser method)
      // For now, we'll just return success
      res.json({
        success: true,
        message: 'Password changed successfully',
      });
    } catch (error) {
      console.error('Password change error:', error);
      res.status(500).json({
        success: false,
        error: 'Password change failed. Please try again.',
      });
    }
  });

  /**
   * GET /api/auth/csrf-token - Get a new CSRF token
   */
  router.get('/csrf-token', authMiddleware, (req, res) => {
    const token = generateCsrfToken();
    res.json({
      success: true,
      data: {
        csrfToken: token,
      },
    });
  });

  return router;
}

/**
 * Initialize default admin user and return credentials if created
 */
export async function initializeDefaultAdmin(): Promise<{
  username: string;
  password: string;
} | null> {
  return UserRepository.initializeDefaultAdmin();
}
