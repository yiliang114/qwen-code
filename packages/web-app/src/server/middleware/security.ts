/**
 * @license
 * Copyright 2025 Qwen Code Team
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Request, Response, NextFunction } from 'express';
import {
  JwtService,
  SessionStore,
  generateSecureToken,
} from '../auth/index.js';

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        username: string;
      };
      sessionId?: string;
    }
  }
}

/**
 * CSRF configuration
 */
const CSRF_TOKEN_LENGTH = 32;
const CSRF_COOKIE_NAME = 'csrf-token';
const CSRF_HEADER_NAME = 'X-CSRF-Token';

/**
 * Generate a CSRF token
 */
export function generateCsrfToken(): string {
  return generateSecureToken(CSRF_TOKEN_LENGTH);
}

/**
 * Attach CSRF token to response
 */
export function attachCsrfToken(req: Request, res: Response): void {
  if (!req.sessionId) {
    req.sessionId = generateSecureToken(32);
  }
  const token = generateCsrfToken();
  res.setHeader(CSRF_HEADER_NAME, token);
  res.cookie(CSRF_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  });
}

/**
 * Verify CSRF token
 */
export function verifyCsrfToken(req: Request): boolean {
  const headerToken = req.headers[CSRF_HEADER_NAME.toLowerCase()] as
    | string
    | undefined;
  const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];

  if (!headerToken || !cookieToken) {
    return false;
  }

  // In a real implementation, you'd validate against a stored token
  // For now, we just check that both tokens exist and match
  return headerToken === cookieToken;
}

/**
 * CSRF protection middleware
 */
export function csrfProtection(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Skip CSRF check for safe methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  if (!verifyCsrfToken(req)) {
    res.status(403).json({
      success: false,
      error: 'CSRF token missing or invalid',
    });
    return;
  }

  next();
}

/**
 * Authentication middleware - verifies JWT or session
 */
export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const authHeader = req.headers.authorization;
  const sessionId = req.headers['x-session-id'] as string | undefined;

  // Try JWT first
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const payload = JwtService.verify(token);

    if (payload) {
      req.user = {
        id: payload.userId,
        username: payload.username,
      };
      return next();
    }
  }

  // Try session
  if (sessionId) {
    const session = SessionStore.getSession(sessionId);
    if (session) {
      req.user = {
        id: session.userId,
        username: session.username,
      };
      req.sessionId = sessionId;
      return next();
    }
  }

  // No valid authentication
  res.status(401).json({
    success: false,
    error: 'Authentication required',
  });
}

/**
 * Optional auth middleware - sets user if authenticated, but doesn't require it
 */
export function optionalAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const authHeader = req.headers.authorization;
  const sessionId = req.headers['x-session-id'] as string | undefined;

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const payload = JwtService.verify(token);
    if (payload) {
      req.user = {
        id: payload.userId,
        username: payload.username,
      };
    }
  } else if (sessionId) {
    const session = SessionStore.getSession(sessionId);
    if (session) {
      req.user = {
        id: session.userId,
        username: session.username,
      };
      req.sessionId = sessionId;
    }
  }

  next();
}

/**
 * Rate limiter configuration
 */
interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  message: string;
}

/**
 * Simple in-memory rate limiter store
 */
class RateLimitStore {
  private store = new Map<string, { count: number; resetTime: number }>();

  /**
   * Check if request is rate limited
   */
  check(
    key: string,
    config: RateLimitConfig,
  ): { limited: boolean; remaining: number } {
    const now = Date.now();
    const record = this.store.get(key);

    if (!record || now > record.resetTime) {
      this.store.set(key, {
        count: 1,
        resetTime: now + config.windowMs,
      });
      return { limited: false, remaining: config.maxRequests - 1 };
    }

    if (record.count >= config.maxRequests) {
      return { limited: true, remaining: 0 };
    }

    record.count++;
    return { limited: false, remaining: config.maxRequests - record.count };
  }

  /**
   * Cleanup old records
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, record] of this.store.entries()) {
      if (now > record.resetTime) {
        this.store.delete(key);
      }
    }
  }
}

const rateLimitStore = new RateLimitStore();

// Auto-cleanup every 5 minutes
setInterval(() => rateLimitStore.cleanup(), 5 * 60 * 1000);

/**
 * Create rate limiter middleware
 */
export function createRateLimiter(config: RateLimitConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Use user ID if authenticated, otherwise IP
    const key =
      req.user?.id || `ip:${req.ip || req.socket.remoteAddress || 'unknown'}`;
    const { limited, remaining } = rateLimitStore.check(key, config);

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', config.maxRequests);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, remaining));

    if (limited) {
      res.setHeader('Retry-After', Math.ceil(config.windowMs / 1000));
      res.status(429).json({
        success: false,
        error: config.message,
      });
      return;
    }

    next();
  };
}

/**
 * Pre-configured rate limiters for common use cases
 */
export const rateLimiters = {
  /**
   * Auth endpoints - strict limiting
   */
  auth: createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 5,
    message: 'Too many authentication attempts. Please try again later.',
  }),

  /**
   * General API endpoints
   */
  api: createRateLimiter({
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 60,
    message: 'Too many requests. Please slow down.',
  }),

  /**
   * File operations
   */
  file: createRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 30,
    message: 'Too many file operations. Please slow down.',
  }),

  /**
   * Tool execution (very strict)
   */
  tool: createRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 10,
    message: 'Too many tool executions. Please slow down.',
  }),
};

/**
 * Security headers middleware
 */
export function securityHeaders(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');

  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // XSS protection
  res.setHeader('X-XSS-Protection', '1; mode=block');

  // Content Security Policy (adjust as needed)
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:;",
  );

  // Referrer policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Permissions policy
  res.setHeader(
    'Permissions-Policy',
    'geolocation=(), microphone=(), camera=(), payment=(), usb=()',
  );

  next();
}

/**
 * CORS configuration
 */
export interface CorsConfig {
  allowedOrigins: string[];
  allowedMethods: string[];
  allowedHeaders: string[];
  credentials: boolean;
  maxAge: number;
}

const defaultCorsConfig: CorsConfig = {
  allowedOrigins: ['http://localhost:*', 'http://127.0.0.1:*'],
  allowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-CSRF-Token',
    'X-Session-ID',
  ],
  credentials: true,
  maxAge: 86400, // 24 hours
};

/**
 * CORS middleware
 */
export function corsMiddleware(config: CorsConfig = defaultCorsConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;

    // Check if origin is allowed (with wildcard support for localhost)
    const isAllowed = config.allowedOrigins.some((allowed) => {
      if (allowed.endsWith('*')) {
        const prefix = allowed.slice(0, -1);
        return origin?.startsWith(prefix);
      }
      return origin === allowed;
    });

    if (isAllowed && origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }

    res.setHeader(
      'Access-Control-Allow-Methods',
      config.allowedMethods.join(', '),
    );
    res.setHeader(
      'Access-Control-Allow-Headers',
      config.allowedHeaders.join(', '),
    );
    res.setHeader('Access-Control-Max-Age', config.maxAge.toString());

    if (config.credentials) {
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    // Handle preflight
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    next();
  };
}

/**
 * Request logging middleware (for security audit)
 */
export function requestLogging(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const method = req.method;
    const path = req.path;
    const status = res.statusCode;
    const ip = req.ip || req.socket.remoteAddress;
    const user = req.user?.username || 'anonymous';

    // Log suspicious activities
    if (status >= 400) {
      console.warn(
        `[SECURITY] ${method} ${path} ${status} ${duration}ms - IP: ${ip} User: ${user}`,
      );
    } else {
      console.log(
        `[REQUEST] ${method} ${path} ${status} ${duration}ms - IP: ${ip} User: ${user}`,
      );
    }
  });

  next();
}
