/**
 * @license
 * Copyright 2025 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CliDetector } from './cliDetector.js';

describe('CliDetector', () => {
  beforeEach(() => {
    // Clear cache before each test
    CliDetector.clearCache();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  describe('getInstallationInstructions', () => {
    it('should return installation instructions', () => {
      const instructions = CliDetector.getInstallationInstructions();
      expect(instructions.title).toBe('Qwen Code CLI is not installed');
      expect(Array.isArray(instructions.steps)).toBe(true);
      expect(instructions.steps.length).toBeGreaterThan(0);
      expect(instructions.documentationUrl).toBe(
        'https://github.com/QwenLM/qwen-code#installation',
      );
    });

    it('should include npm installation step', () => {
      const instructions = CliDetector.getInstallationInstructions();
      const hasNpmStep = instructions.steps.some((step) =>
        step.includes('npm install -g @qwen-code/qwen-code@latest'),
      );
      expect(hasNpmStep).toBe(true);
    });
  });
});
