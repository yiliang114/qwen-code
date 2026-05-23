/**
 * @license
 * Copyright 2025 Qwen Code Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomBytes, createHash, randomInt } from 'crypto';

const SALT_LENGTH = 16;
const ITERATIONS = 10000;
const KEY_LENGTH = 64;
const DIGEST = 'sha512';

/**
 * Password hashing service using PBKDF2
 */
export class PasswordHasher {
  /**
   * Hash a password with a random salt
   */
  static async hashPassword(
    password: string,
  ): Promise<{ hash: string; salt: string }> {
    return new Promise((resolve, reject) => {
      const salt = randomBytes(SALT_LENGTH).toString('hex');
      pbkdf2(
        password,
        salt,
        ITERATIONS,
        KEY_LENGTH,
        DIGEST,
        (err, derivedKey) => {
          if (err) reject(err);
          else resolve({ hash: derivedKey.toString('hex'), salt });
        },
      );
    });
  }

  /**
   * Verify a password against a stored hash
   */
  static async verifyPassword(
    password: string,
    storedHash: string,
    salt: string,
  ): Promise<boolean> {
    return new Promise((resolve, reject) => {
      pbkdf2(
        password,
        salt,
        ITERATIONS,
        KEY_LENGTH,
        DIGEST,
        (err, derivedKey) => {
          if (err) reject(err);
          else resolve(derivedKey.toString('hex') === storedHash);
        },
      );
    });
  }
}

// Polyfill for pbkdf2 in case it's not available
function pbkdf2(
  password: string | Buffer,
  salt: string | Buffer,
  iterations: number,
  keylen: number,
  digest: string,
  callback: (err: Error | null, derivedKey?: Buffer) => void,
): void {
  if (typeof randomBytes === 'function') {
    // Node.js crypto.pbkdf2
    import('crypto').then(({ pbkdf2: nodePbkdf2 }) => {
      nodePbkdf2(password, salt, iterations, keylen, digest, callback);
    });
  } else {
    // Fallback for environments without crypto
    callback(new Error('crypto.pbkdf2 not available'));
  }
}

/**
 * Generate a secure random password
 */
export function generateRandomPassword(length = 12): string {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars[randomInt(0, chars.length)];
  }
  return password;
}

/**
 * Generate a secure random token (for JWT, session ID, etc.)
 */
export function generateSecureToken(length = 32): string {
  return randomBytes(length).toString('hex');
}

/**
 * Simple JWT implementation for authentication
 */
export interface JwtPayload {
  userId: string;
  username: string;
  iat?: number;
  exp?: number;
}

export class JwtService {
  private static readonly SECRET =
    process.env.JWT_SECRET || generateSecureToken(64);
  private static readonly EXPIRY = '24h';

  /**
   * Sign a JWT token
   */
  static sign(payload: JwtPayload): string {
    const header = { alg: 'HS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const tokenPayload = {
      ...payload,
      iat: now,
      exp: now + 86400, // 24 hours in seconds
    };

    const headerEncoded = Buffer.from(JSON.stringify(header)).toString(
      'base64url',
    );
    const payloadEncoded = Buffer.from(JSON.stringify(tokenPayload)).toString(
      'base64url',
    );
    const signature = this.createSignature(
      `${headerEncoded}.${payloadEncoded}`,
    );

    return `${headerEncoded}.${payloadEncoded}.${signature}`;
  }

  /**
   * Verify and decode a JWT token
   */
  static verify(token: string): JwtPayload | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;

      const [headerEncoded, payloadEncoded, signature] = parts;
      const expectedSignature = this.createSignature(
        `${headerEncoded}.${payloadEncoded}`,
      );

      if (signature !== expectedSignature) return null;

      const payload = JSON.parse(
        Buffer.from(payloadEncoded, 'base64url').toString('utf-8'),
      );

      // Check expiration
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
        return null;
      }

      return payload as JwtPayload;
    } catch {
      return null;
    }
  }

  private static createSignature(data: string): string {
    return createHash('sha256')
      .update(data + this.SECRET)
      .digest('base64url');
  }
}

/**
 * User repository (in-memory for now, can be replaced with database)
 */
export interface User {
  id: string;
  username: string;
  passwordHash: string;
  salt: string;
  createdAt: Date;
}

export class UserRepository {
  private static users = new Map<string, User>();
  private static usernameIndex = new Map<string, string>();

  /**
   * Create a new user
   */
  static async createUser(
    username: string,
    password: string,
  ): Promise<{ user: User; password?: string } | null> {
    // Check if username already exists
    if (this.usernameIndex.has(username)) {
      return null;
    }

    const { hash, salt } = await PasswordHasher.hashPassword(password);
    const user: User = {
      id: generateSecureToken(16),
      username,
      passwordHash: hash,
      salt,
      createdAt: new Date(),
    };

    this.users.set(user.id, user);
    this.usernameIndex.set(username, user.id);

    return { user };
  }

  /**
   * Find user by username
   */
  static findByUsername(username: string): User | undefined {
    const userId = this.usernameIndex.get(username);
    return userId ? this.users.get(userId) : undefined;
  }

  /**
   * Find user by ID
   */
  static findById(id: string): User | undefined {
    return this.users.get(id);
  }

  /**
   * Initialize default admin user
   */
  static async initializeDefaultAdmin(): Promise<{
    username: string;
    password: string;
  } | null> {
    const defaultUsername = process.env.DEFAULT_ADMIN_USERNAME || 'admin';
    const existingUser = this.findByUsername(defaultUsername);

    if (existingUser && existingUser.passwordHash.length > 0) {
      return null; // Already initialized
    }

    const tempPassword = generateRandomPassword(16);
    await this.createUser(defaultUsername, tempPassword);

    return { username: defaultUsername, password: tempPassword };
  }

  /**
   * Get all users (for admin purposes only)
   */
  static getAllUsers(): Array<Omit<User, 'passwordHash' | 'salt'>> {
    return Array.from(this.users.values()).map(
      ({ passwordHash: _passwordHash, salt: _salt, ...rest }) => rest,
    );
  }
}

/**
 * Session store for managing authenticated sessions
 */
export interface AuthSession {
  id: string;
  userId: string;
  username: string;
  createdAt: Date;
  lastActivity: Date;
  expiresAt: Date;
}

export class SessionStore {
  private static sessions = new Map<string, AuthSession>();
  private static readonly SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours

  /**
   * Create a new session
   */
  static createSession(userId: string, username: string): AuthSession {
    const now = new Date();
    const session: AuthSession = {
      id: generateSecureToken(32),
      userId,
      username,
      createdAt: now,
      lastActivity: now,
      expiresAt: new Date(now.getTime() + this.SESSION_DURATION),
    };

    this.sessions.set(session.id, session);
    return session;
  }

  /**
   * Get session by ID
   */
  static getSession(sessionId: string): AuthSession | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;

    // Check expiration
    if (session.expiresAt < new Date()) {
      this.deleteSession(sessionId);
      return undefined;
    }

    // Update last activity
    session.lastActivity = new Date();
    return session;
  }

  /**
   * Delete session
   */
  static deleteSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /**
   * Cleanup expired sessions
   */
  static cleanupExpiredSessions(): void {
    const now = new Date();
    for (const [id, session] of this.sessions.entries()) {
      if (session.expiresAt < now) {
        this.sessions.delete(id);
      }
    }
  }

  /**
   * Get active sessions count
   */
  static getActiveSessionsCount(): number {
    return this.sessions.size;
  }
}

// Auto-cleanup expired sessions every hour
setInterval(() => SessionStore.cleanupExpiredSessions(), 60 * 60 * 1000);
