/**
 * @license
 * Copyright 2025 Qwen Code Team
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import { networkInterfaces } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { createAuthRouter, initializeDefaultAdmin } from './routes/auth.js';
import { sessionsRouter } from './routes/sessions.js';
import {
  securityHeaders,
  corsMiddleware,
  requestLogging,
  rateLimiters,
  optionalAuthMiddleware,
} from './middleware/security.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Web server configuration
 */
export interface WebServerConfig {
  port: number;
  host: string;
  allowRemote: boolean;
  enableAuth: boolean;
  enableCors: boolean;
  enableRateLimit: boolean;
  enableLogging: boolean;
}

const DEFAULT_CONFIG: Partial<WebServerConfig> = {
  port: 5494,
  host: '127.0.0.1',
  allowRemote: false,
  enableAuth: true,
  enableCors: true,
  enableRateLimit: true,
  enableLogging: true,
};

/**
 * Create Express application with security middleware
 */
export function createApp(config: Partial<WebServerConfig> = {}) {
  const appConfig = { ...DEFAULT_CONFIG, ...config };
  const app = express();

  // Trust proxy for proper IP detection
  app.set('trust proxy', true);

  // Parse JSON bodies
  app.use(express.json({ limit: '10mb' }));

  // Parse URL-encoded bodies
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Security headers (always enabled)
  app.use(securityHeaders);

  // CORS (configurable)
  if (appConfig.enableCors) {
    const allowedOrigins = appConfig.allowRemote
      ? ['http://localhost:*', 'http://127.0.0.1:*'] // Can be extended for remote access
      : ['http://localhost:*', 'http://127.0.0.1:*'];
    app.use(corsMiddleware({ allowedOrigins }));
  }

  // Request logging (configurable)
  if (appConfig.enableLogging) {
    app.use(requestLogging);
  }

  // Rate limiting (configurable)
  if (appConfig.enableRateLimit) {
    app.use(rateLimiters.api);
  }

  // Health check endpoint (no auth required)
  app.get('/healthz', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || 'unknown',
    });
  });

  // Auth routes (no additional auth required - they handle auth internally)
  app.use('/api/auth', createAuthRouter());

  // Session routes (require auth if enabled)
  if (appConfig.enableAuth) {
    app.use('/api/sessions', optionalAuthMiddleware, sessionsRouter());
  } else {
    app.use('/api/sessions', sessionsRouter());
  }

  // Serve static files in production
  const staticDir = path.join(__dirname, '../../dist/client');
  app.use(
    express.static(staticDir, {
      setHeaders: (res) => {
        res.setHeader('Cache-Control', 'no-cache');
      },
    }),
  );

  // SPA fallback - serve index.html for unknown routes
  app.get('*', (req, res, next) => {
    // Skip API routes
    if (req.path.startsWith('/api/') || req.path.startsWith('/ws')) {
      return next();
    }

    res.sendFile(path.join(staticDir, 'index.html'), (err) => {
      if (err) {
        res.status(404).json({ error: 'Not found' });
      }
    });
  });

  // Error handling middleware (must be last)
  app.use(
    (
      err: Error,
      req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      console.error('Unhandled error:', err);

      res.status(500).json({
        success: false,
        error:
          process.env.NODE_ENV === 'production'
            ? 'Internal server error'
            : err.message,
      });
    },
  );

  return app;
}

/**
 * Display initial admin credentials
 */
function displayInitialCredentials(
  credentials: { username: string; password: string },
  localUrl: string,
  allowRemote: boolean,
  networkUrl?: string,
): void {
  console.log('\n' + '='.repeat(70));
  console.log('🔐 Qwen Code Web Server - Initial Setup');
  console.log('='.repeat(70));
  console.log(`\n📍 Local URL:    ${localUrl}`);

  if (allowRemote && networkUrl && networkUrl !== localUrl) {
    console.log(`📍 Network URL:  ${networkUrl}`);
  }

  console.log('\n👤 Default Admin Credentials:');
  console.log(`   Username: ${credentials.username}`);
  console.log(`   Password: ${credentials.password}`);
  console.log('\n⚠️  Please change the password after first login!');
  console.log('='.repeat(70) + '\n');
}

/**
 * Get server IP address for remote access
 */
function getServerIP(): string | null {
  const nets = networkInterfaces();

  for (const name of Object.keys(nets)) {
    const netInfo = nets[name];
    if (!netInfo) continue;

    for (const net of netInfo) {
      const isIPv4 = net.family === 'IPv4';
      const isNotInternal = !net.internal;
      if (isIPv4 && isNotInternal) {
        return net.address;
      }
    }
  }

  return null;
}

/**
 * Start the web server
 */
export async function startWebServer(options: {
  port?: number;
  host?: string;
  allowRemote?: boolean;
  enableAuth?: boolean;
}): Promise<{
  port: number;
  host: string;
  credentials?: { username: string; password: string };
}> {
  const {
    port = DEFAULT_CONFIG.port,
    host = DEFAULT_CONFIG.host,
    allowRemote = false,
    enableAuth = true,
  } = options;

  // Create app with configuration
  const app = createApp({
    port,
    host,
    allowRemote,
    enableAuth,
  });

  // Create HTTP server
  const { createServer } = await import('http');
  const server = createServer(app);

  // Setup WebSocket
  const { WebSocketServer } = await import('ws');
  const wss = new WebSocketServer({ server, path: '/ws' });

  // Initialize default admin user
  const initialCredentials = await initializeDefaultAdmin();

  // Start server
  return new Promise((resolve, reject) => {
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`❌ Port ${port} is already in use`);
      } else {
        console.error('❌ Server error:', err);
      }
      reject(err);
    });

    server.listen(port, host, () => {
      const localUrl = `http://${host}:${port}`;
      const serverIP = getServerIP();
      const networkUrl = serverIP ? `http://${serverIP}:${port}` : undefined;

      // Display credentials if this is the first run
      if (initialCredentials && enableAuth) {
        displayInitialCredentials(
          initialCredentials,
          localUrl,
          allowRemote,
          networkUrl,
        );
      } else {
        if (allowRemote && serverIP) {
          console.log(`\n   🚀 Local access:   ${localUrl}`);
          console.log(`   🚀 Network access: ${networkUrl}\n`);
        } else {
          console.log(`\n   🚀 Web UI started: ${localUrl}\n`);
        }
      }

      // Setup WebSocket handler
      const { setupWebSocket } = await import('./websocket/handler.js');
      setupWebSocket(wss);

      resolve({
        port,
        host,
        credentials: initialCredentials || undefined,
      });
    });
  });
}

// CLI entry point
async function startFromEnv(): Promise<void> {
  const env = process.env as Record<string, string | undefined>;

  const host = env['QWEN_CODE_WEB_HOST'] || '127.0.0.1';
  const port = Number(env['QWEN_CODE_WEB_PORT']) || 5494;
  const allowRemote = env['QWEN_CODE_WEB_REMOTE'] === 'true';
  const enableAuth = env['QWEN_CODE_WEB_AUTH'] !== 'false';

  try {
    await startWebServer({
      port,
      host,
      allowRemote,
      enableAuth,
    });
  } catch (error) {
    console.error('Failed to start web server:', error);
    process.exit(1);
  }
}

// Check if this is the main module
function isMainModule(): boolean {
  if (!process.argv[1]) {
    return false;
  }
  const { pathToFileURL } = await import('url');
  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  startFromEnv();
}
