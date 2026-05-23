/**
 * @license
 * Copyright 2025 Qwen Code Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, beforeEach } from 'vitest';
import assert from 'node:assert';
import express from 'express';
import request from 'supertest';
import {
  createRateLimiter,
  corsMiddleware,
  securityHeaders,
  generateCsrfToken,
} from './security.js';

describe('Security Middleware', () => {
  describe('generateCsrfToken', () => {
    it('should generate unique tokens', () => {
      const tokens = new Set();
      for (let i = 0; i < 10; i++) {
        tokens.add(generateCsrfToken());
      }
      assert.strictEqual(tokens.size, 10);
    });

    it('should generate token of expected length', () => {
      const token = generateCsrfToken();
      assert.strictEqual(token.length, 64); // 32 bytes hex = 64 chars
    });
  });

  describe('createRateLimiter', () => {
    let app: express.Express;

    beforeEach(() => {
      app = express();
      app.use(
        createRateLimiter({
          windowMs: 60000,
          maxRequests: 5,
          message: 'Too many requests',
        }),
      );
      app.get('/test', (req, res) => {
        res.json({ success: true });
      });
    });

    it('should allow requests under limit', async () => {
      for (let i = 0; i < 5; i++) {
        const response = await request(app).get('/test');
        assert.ok(response.headers['x-ratelimit-remaining'] !== undefined);
      }
    });

    it('should set rate limit headers', async () => {
      const response = await request(app).get('/test');

      assert.strictEqual(response.headers['x-ratelimit-limit'], '5');
      assert.ok(response.headers['x-ratelimit-remaining']);
    });
  });

  describe('corsMiddleware', () => {
    let app: express.Express;

    beforeEach(() => {
      app = express();
      app.use(
        corsMiddleware({
          allowedOrigins: ['http://localhost:3000', 'http://localhost:*'],
          allowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
          allowedHeaders: ['Content-Type', 'Authorization'],
          credentials: true,
          maxAge: 86400,
        }),
      );
      app.get('/test', (req, res) => {
        res.json({ success: true });
      });
    });

    it('should set CORS headers for allowed origin', async () => {
      const response = await request(app)
        .get('/test')
        .set('Origin', 'http://localhost:3000');

      assert.strictEqual(
        response.headers['access-control-allow-origin'],
        'http://localhost:3000',
      );
      assert.strictEqual(
        response.headers['access-control-allow-credentials'],
        'true',
      );
    });

    it('should handle wildcard origin pattern', async () => {
      const response = await request(app)
        .get('/test')
        .set('Origin', 'http://localhost:5494');

      assert.strictEqual(
        response.headers['access-control-allow-origin'],
        'http://localhost:5494',
      );
    });

    it('should not set CORS headers for disallowed origin', async () => {
      const response = await request(app)
        .get('/test')
        .set('Origin', 'http://evil.com');

      assert.strictEqual(
        response.headers['access-control-allow-origin'],
        undefined,
      );
    });

    it('should handle preflight OPTIONS request', async () => {
      const response = await request(app)
        .options('/test')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'Content-Type');

      assert.strictEqual(response.status, 204);
    });
  });

  describe('securityHeaders', () => {
    let app: express.Express;

    beforeEach(() => {
      app = express();
      app.use(securityHeaders);
      app.get('/test', (req, res) => {
        res.json({ success: true });
      });
    });

    it('should set X-Frame-Options header', async () => {
      const response = await request(app).get('/test');
      assert.strictEqual(response.headers['x-frame-options'], 'DENY');
    });

    it('should set X-Content-Type-Options header', async () => {
      const response = await request(app).get('/test');
      assert.strictEqual(response.headers['x-content-type-options'], 'nosniff');
    });

    it('should set X-XSS-Protection header', async () => {
      const response = await request(app).get('/test');
      assert.strictEqual(response.headers['x-xss-protection'], '1; mode=block');
    });

    it('should set Content-Security-Policy header', async () => {
      const response = await request(app).get('/test');
      assert.ok(response.headers['content-security-policy']);
      assert.ok(
        (response.headers['content-security-policy'] as string).includes(
          "default-src 'self'",
        ),
      );
    });

    it('should set Referrer-Policy header', async () => {
      const response = await request(app).get('/test');
      assert.strictEqual(
        response.headers['referrer-policy'],
        'strict-origin-when-cross-origin',
      );
    });

    it('should set Permissions-Policy header', async () => {
      const response = await request(app).get('/test');
      assert.ok(response.headers['permissions-policy']);
      assert.ok(
        (response.headers['permissions-policy'] as string).includes(
          'geolocation=()',
        ),
      );
    });
  });
});
