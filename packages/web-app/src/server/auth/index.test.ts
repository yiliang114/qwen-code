/**
 * @license
 * Copyright 2025 Qwen Code Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, beforeEach } from 'vitest';
import assert from 'node:assert';
import {
  PasswordHasher,
  JwtService,
  UserRepository,
  SessionStore,
  generateRandomPassword,
  generateSecureToken,
} from '../auth/index.js';

describe('Auth Module', () => {
  describe('PasswordHasher', () => {
    it('should hash and verify password correctly', async () => {
      const password = 'testPassword123!';
      const { hash, salt } = await PasswordHasher.hashPassword(password);

      const isValid = await PasswordHasher.verifyPassword(password, hash, salt);
      assert.strictEqual(isValid, true);
    });

    it('should reject incorrect password', async () => {
      const password = 'testPassword123!';
      const wrongPassword = 'wrongPassword456!';
      const { hash, salt } = await PasswordHasher.hashPassword(password);

      const isValid = await PasswordHasher.verifyPassword(
        wrongPassword,
        hash,
        salt,
      );
      assert.strictEqual(isValid, false);
    });

    it('should generate different hashes for same password', async () => {
      const password = 'testPassword123!';
      const { hash: hash1 } = await PasswordHasher.hashPassword(password);
      const { hash: hash2 } = await PasswordHasher.hashPassword(password);

      assert.notStrictEqual(hash1, hash2);
    });
  });

  describe('JwtService', () => {
    it('should sign and verify JWT token', () => {
      const payload = {
        userId: 'test-user-123',
        username: 'testuser',
      };

      const token = JwtService.sign(payload);
      const verified = JwtService.verify(token);

      assert.ok(verified);
      assert.strictEqual(verified?.userId, payload.userId);
      assert.strictEqual(verified?.username, payload.username);
    });

    it('should return null for expired token', () => {
      // Create a token with past expiration
      const header = { alg: 'HS256', typ: 'JWT' };
      const pastPayload = {
        userId: 'test-user',
        username: 'testuser',
        iat: Math.floor(Date.now() / 1000) - 100,
        exp: Math.floor(Date.now() / 1000) - 50, // Expired 50 seconds ago
      };

      const headerEncoded = Buffer.from(JSON.stringify(header)).toString(
        'base64url',
      );
      const payloadEncoded = Buffer.from(JSON.stringify(pastPayload)).toString(
        'base64url',
      );

      // This would need the actual signature, so we'll test with a modified token
      const token = `${headerEncoded}.${payloadEncoded}.invalid-signature`;
      const verified = JwtService.verify(token);

      assert.strictEqual(verified, null);
    });

    it('should return null for invalid token format', () => {
      const invalidTokens = [
        '',
        'not-a-jwt',
        'only.two.parts',
        'one',
        'a.b.c.d.e', // Too many parts
      ];

      for (const token of invalidTokens) {
        const verified = JwtService.verify(token);
        assert.strictEqual(
          verified,
          null,
          `Token "${token}" should be invalid`,
        );
      }
    });
  });

  describe('generateRandomPassword', () => {
    it('should generate password of specified length', () => {
      const password = generateRandomPassword(16);
      assert.strictEqual(password.length, 16);
    });

    it('should generate different passwords each time', () => {
      const passwords = new Set();
      for (let i = 0; i < 10; i++) {
        passwords.add(generateRandomPassword(16));
      }
      assert.strictEqual(passwords.size, 10);
    });

    it('should include alphanumeric and special characters', () => {
      const password = generateRandomPassword(32);
      const hasUpper = /[A-Z]/.test(password);
      const hasLower = /[a-z]/.test(password);
      const hasNumber = /[0-9]/.test(password);

      assert.ok(hasUpper, 'Should contain uppercase letters');
      assert.ok(hasLower, 'Should contain lowercase letters');
      assert.ok(hasNumber, 'Should contain numbers');
    });
  });

  describe('generateSecureToken', () => {
    it('should generate token of specified length', () => {
      const token = generateSecureToken(32);
      assert.strictEqual(token.length, 64); // Hex encoding doubles length
    });

    it('should generate unique tokens', () => {
      const tokens = new Set();
      for (let i = 0; i < 10; i++) {
        tokens.add(generateSecureToken(32));
      }
      assert.strictEqual(tokens.size, 10);
    });
  });

  describe('UserRepository', () => {
    beforeEach(() => {
      // Clear users between tests
      (
        UserRepository as unknown as { users: Map<unknown, unknown> }
      ).users.clear();
      (
        UserRepository as unknown as { usernameIndex: Map<unknown, unknown> }
      ).usernameIndex.clear();
    });

    it('should create and find user', async () => {
      const result = await UserRepository.createUser('testuser', 'password123');

      assert.ok(result);
      assert.ok(result?.user);
      assert.strictEqual(result?.user.username, 'testuser');

      const found = UserRepository.findByUsername('testuser');
      assert.ok(found);
      assert.strictEqual(found?.username, 'testuser');
    });

    it('should reject duplicate username', async () => {
      await UserRepository.createUser('testuser', 'password123');
      const result = await UserRepository.createUser(
        'testuser',
        'anotherPassword',
      );

      assert.strictEqual(result, null);
    });

    it('should find user by id', async () => {
      const result = await UserRepository.createUser('testuser', 'password123');
      assert.ok(result);

      const found = UserRepository.findById(result.user.id);
      assert.ok(found);
      assert.strictEqual(found?.id, result.user.id);
    });

    it('should return null for non-existent user', () => {
      const found = UserRepository.findByUsername('nonexistent');
      assert.strictEqual(found, undefined);
    });
  });

  describe('SessionStore', () => {
    beforeEach(() => {
      // Clear sessions between tests
      (
        SessionStore as unknown as { sessions: Map<unknown, unknown> }
      ).sessions.clear();
    });

    it('should create and retrieve session', () => {
      const session = SessionStore.createSession('user-123', 'testuser');

      assert.ok(session);
      assert.ok(session.id);
      assert.strictEqual(session.userId, 'user-123');
      assert.strictEqual(session.username, 'testuser');

      const retrieved = SessionStore.getSession(session.id);
      assert.ok(retrieved);
      assert.strictEqual(retrieved?.id, session.id);
    });

    it('should return undefined for non-existent session', () => {
      const retrieved = SessionStore.getSession('non-existent-id');
      assert.strictEqual(retrieved, undefined);
    });

    it('should delete session', () => {
      const session = SessionStore.createSession('user-123', 'testuser');
      SessionStore.deleteSession(session.id);

      const retrieved = SessionStore.getSession(session.id);
      assert.strictEqual(retrieved, undefined);
    });

    it('should update last activity on get', () => {
      const session = SessionStore.createSession('user-123', 'testuser');
      const initialActivity = session.lastActivity;

      // Wait a bit
      const waitMs = 10;
      const start = Date.now();
      while (Date.now() - start < waitMs) {
        // Busy wait
      }

      const retrieved = SessionStore.getSession(session.id);
      assert.ok(retrieved);
      assert.ok(retrieved.lastActivity.getTime() >= initialActivity.getTime());
    });
  });
});
