/**
 * @license
 * Copyright 2025 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { CliInstaller } from './CliInstaller.js';
import { CliDetector } from './cliDetector.js';

// Mock vscode
vi.mock('vscode', () => ({
  window: {
    showWarningMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    withProgress: vi.fn().mockImplementation(async (_, task) => {
      await task({ report: vi.fn() });
    }),
    createTerminal: vi.fn().mockReturnValue({
      show: vi.fn(),
      sendText: vi.fn(),
    }),
  },
  env: {
    openExternal: vi.fn(),
  },
  Uri: {
    parse: vi.fn().mockImplementation((url) => url),
  },
  ProgressLocation: {
    Notification: 15,
  },
  commands: {
    executeCommand: vi.fn(),
  },
}));

describe('CliInstaller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('checkInstallation', () => {
    it('should send detection result to WebView when CLI is installed', async () => {
      const mockSendToWebView = vi.fn();
      const mockDetectionResult = {
        isInstalled: true,
        cliPath: '/usr/local/bin/qwen',
        version: '1.0.0',
      };

      vi.spyOn(CliDetector, 'detectQwenCli').mockResolvedValue(
        mockDetectionResult,
      );
      vi.spyOn(CliDetector, 'getInstallationInstructions').mockReturnValue({
        title: 'Qwen Code CLI is not installed',
        steps: ['npm install -g @qwen-code/qwen-code@latest'],
        documentationUrl: 'https://github.com/QwenLM/qwen-code#installation',
      });

      await CliInstaller.checkInstallation(mockSendToWebView);

      expect(mockSendToWebView).toHaveBeenCalledWith({
        type: 'cliDetectionResult',
        data: {
          isInstalled: true,
          cliPath: '/usr/local/bin/qwen',
          version: '1.0.0',
          error: undefined,
          installInstructions: undefined,
        },
      });
    });

    it('should send detection result to WebView when CLI is not installed', async () => {
      const mockSendToWebView = vi.fn();
      const mockDetectionResult = {
        isInstalled: false,
        error: 'CLI not found',
      };

      vi.spyOn(CliDetector, 'detectQwenCli').mockResolvedValue(
        mockDetectionResult,
      );
      vi.spyOn(CliDetector, 'getInstallationInstructions').mockReturnValue({
        title: 'Qwen Code CLI is not installed',
        steps: ['npm install -g @qwen-code/qwen-code@latest'],
        documentationUrl: 'https://github.com/QwenLM/qwen-code#installation',
      });

      await CliInstaller.checkInstallation(mockSendToWebView);

      expect(mockSendToWebView).toHaveBeenCalledWith({
        type: 'cliDetectionResult',
        data: {
          isInstalled: false,
          cliPath: undefined,
          version: undefined,
          error: 'CLI not found',
          installInstructions: {
            title: 'Qwen Code CLI is not installed',
            steps: ['npm install -g @qwen-code/qwen-code@latest'],
            documentationUrl:
              'https://github.com/QwenLM/qwen-code#installation',
          },
        },
      });
    });

    it('should handle detection errors gracefully', async () => {
      const mockSendToWebView = vi.fn();
      vi.spyOn(CliDetector, 'detectQwenCli').mockRejectedValue(
        new Error('Detection failed'),
      );

      await CliInstaller.checkInstallation(mockSendToWebView);
      // Should not throw, just log the error
      expect(mockSendToWebView).not.toHaveBeenCalled();
    });
  });

  describe('promptInstallation', () => {
    it('should show warning message with installation options', async () => {
      vi.mocked(vscode.window.showWarningMessage).mockImplementation(() =>
        Promise.resolve({ title: 'Install Now' }),
      );

      await CliInstaller.promptInstallation();

      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        'Qwen Code CLI is not installed. You can browse conversation history, but cannot send new messages.',
        { title: 'Install Now' },
        { title: 'View Documentation' },
        { title: 'Remind Me Later' },
      );
    });

    it('should install CLI when user selects "Install Now"', async () => {
      vi.mocked(vscode.window.showWarningMessage).mockImplementation(() =>
        Promise.resolve({ title: 'Install Now' }),
      );
      const installSpy = vi.spyOn(CliInstaller, 'install').mockResolvedValue();

      await CliInstaller.promptInstallation();

      expect(installSpy).toHaveBeenCalled();
    });

    it('should open documentation when user selects "View Documentation"', async () => {
      vi.mocked(vscode.window.showWarningMessage).mockImplementation(() =>
        Promise.resolve({ title: 'View Documentation' }),
      );

      await CliInstaller.promptInstallation();

      expect(vscode.env.openExternal).toHaveBeenCalledWith(
        'https://github.com/QwenLM/qwen-code#installation',
      );
    });

    it('should do nothing when user selects "Remind Me Later"', async () => {
      vi.mocked(vscode.window.showWarningMessage).mockImplementation(() =>
        Promise.resolve({ title: 'Remind Me Later' }),
      );

      await CliInstaller.promptInstallation();

      expect(vscode.env.openExternal).not.toHaveBeenCalled();
      expect(CliInstaller.install).not.toHaveBeenCalled();
    });
  });
});
