/**
 * @license
 * Copyright 2025 Qwen Code Team
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SlashCommand } from '../ui/commands/types.js';
import type { CommandContext } from '../services/types.js';

/**
 * Web command - Start the Web GUI server
 */
export const webCommand: SlashCommand = {
  name: 'web',
  description: 'Start the Web GUI server for remote access',
  usage: '/web [options]',
  options: [
    {
      name: '--port',
      description: 'Server port (default: 5494)',
      type: 'string',
    },
    {
      name: '--host',
      description: 'Server host (default: 127.0.0.1)',
      type: 'string',
    },
    {
      name: '--remote',
      description: 'Allow remote access from network',
      type: 'boolean',
    },
    {
      name: '--no-auth',
      description: 'Disable authentication (not recommended)',
      type: 'boolean',
    },
  ],

  action: async (context: CommandContext, args: string): Promise<void> => {
    const portArg = args.match(/--port\s+(\d+)/)?.[1];
    const hostArg = args.match(/--host\s+(\S+)/)?.[1];
    const remote = args.includes('--remote');
    const noAuth = args.includes('--no-auth');

    const port = portArg ? parseInt(portArg, 10) : 5494;
    const host = hostArg || '127.0.0.1';

    context.ui.addItem(
      {
        type: 'info',
        text:
          `Starting Web GUI server on http://${host}:${port}...\n` +
          `  Remote access: ${remote ? 'Enabled' : 'Disabled'}\n` +
          `  Authentication: ${noAuth ? 'Disabled (insecure!)' : 'Enabled'}`,
      },
      Date.now(),
    );

    try {
      // Dynamically import to avoid circular dependencies
      const { startWebServer } = await import('@qwen-code/web-app/server');

      await startWebServer({
        port,
        host,
        allowRemote: remote,
        enableAuth: !noAuth,
      });

      context.ui.addItem(
        {
          type: 'success',
          text:
            `\n✅ Web GUI server started successfully!\n\n` +
            `Open your browser at: http://${host}:${port}\n` +
            (remote
              ? `\n🌐 Network access enabled - use your device IP instead of localhost\n`
              : '') +
            (noAuth
              ? '\n⚠️  WARNING: Authentication is disabled. This is insecure on network!\n'
              : ''),
        },
        Date.now(),
      );
    } catch (error) {
      context.ui.addItem(
        {
          type: 'error',
          text: `Failed to start Web GUI server: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
        Date.now(),
      );
    }
  },
};
