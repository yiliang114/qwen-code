/**
 * @license
 * Copyright 2025 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CliVersionManager,
  MIN_CLI_VERSION_FOR_SESSION_METHODS,
} from './cliVersionManager.js';
import { CliDetector } from './cliDetector.js';
import type { CliDetectionResult } from './cliDetector.js';

describe('CliVersionManager', () => {
  let cliVersionManager: CliVersionManager;

  beforeEach(() => {
    // Get a fresh instance for each test and clear cache
    cliVersionManager = CliVersionManager.getInstance();
    cliVersionManager.clearCache();
    vi.useRealTimers();
  });

  describe('getInstance', () => {
    it('should return a singleton instance', () => {
      const instance1 = CliVersionManager.getInstance();
      const instance2 = CliVersionManager.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('isVersionSupported', () => {
    it('should return false for undefined version', () => {
      // @ts-expect-error - accessing private method for testing
      const result = cliVersionManager.isVersionSupported(undefined, '0.2.4');
      expect(result).toBe(false);
    });

    it('should return false for invalid version format', () => {
      // @ts-expect-error - accessing private method for testing
      const result = cliVersionManager.isVersionSupported(
        'invalid.version',
        '0.2.4',
      );
      expect(result).toBe(false);
    });

    it('should return true for version that meets minimum requirement', () => {
      // @ts-expect-error - accessing private method for testing
      const result = cliVersionManager.isVersionSupported('1.0.0', '0.2.4');
      expect(result).toBe(true);
    });

    it('should return false for version that does not meet minimum requirement', () => {
      // @ts-expect-error - accessing private method for testing
      const result = cliVersionManager.isVersionSupported('0.1.0', '0.2.4');
      expect(result).toBe(false);
    });

    it('should return true for exact version match', () => {
      // @ts-expect-error - accessing private method for testing
      const result = cliVersionManager.isVersionSupported('0.2.4', '0.2.4');
      expect(result).toBe(true);
    });

    it('should handle versions with different number of parts', () => {
      // @ts-expect-error - accessing private method for testing
      const result1 = cliVersionManager.isVersionSupported('0.2.4.1', '0.2.4');
      expect(result1).toBe(true);

      // @ts-expect-error - accessing private method for testing
      const result2 = cliVersionManager.isVersionSupported('0.2', '0.2.4');
      expect(result2).toBe(false);
    });
  });

  describe('getFeatureFlags', () => {
    it('should return all false features for undefined version', () => {
      // @ts-expect-error - accessing private method for testing
      const features = cliVersionManager.getFeatureFlags(undefined);
      expect(features).toEqual({
        supportsSessionList: false,
        supportsSessionLoad: false,
        supportsSessionSave: false,
      });
    });

    it('should return session features as true for supported version', () => {
      // @ts-expect-error - accessing private method for testing
      const features = cliVersionManager.getFeatureFlags('1.0.0');
      expect(features.supportsSessionList).toBe(true);
      expect(features.supportsSessionLoad).toBe(true);
      expect(features.supportsSessionSave).toBe(false);
    });

    it('should return all session features as false for unsupported version', () => {
      // @ts-expect-error - accessing private method for testing
      const features = cliVersionManager.getFeatureFlags('0.1.0');
      expect(features.supportsSessionList).toBe(false);
      expect(features.supportsSessionLoad).toBe(false);
      expect(features.supportsSessionSave).toBe(false);
    });
  });

  describe('detectCliVersion', () => {
    it('should return fallback result when detection fails', async () => {
      vi.spyOn(CliDetector, 'detectQwenCli').mockRejectedValue(
        new Error('CLI not found'),
      );

      const result = await cliVersionManager.detectCliVersion();
      expect(result.version).toBeUndefined();
      expect(result.isSupported).toBe(false);
      expect(result.features.supportsSessionList).toBe(false);
      expect(result.features.supportsSessionLoad).toBe(false);
      expect(result.features.supportsSessionSave).toBe(false);
      expect(result.detectionResult.isInstalled).toBe(false);
    });

    it('should return version info when detection succeeds', async () => {
      const detectionResult: CliDetectionResult = {
        isInstalled: true,
        version: '1.0.0',
        cliPath: '/usr/local/bin/qwen',
      };
      vi.spyOn(CliDetector, 'detectQwenCli').mockResolvedValue(detectionResult);

      const result = await cliVersionManager.detectCliVersion();
      expect(result.version).toBe('1.0.0');
      expect(result.isSupported).toBe(true);
      expect(result.features.supportsSessionList).toBe(true);
      expect(result.features.supportsSessionLoad).toBe(true);
      expect(result.features.supportsSessionSave).toBe(false);
      expect(result.detectionResult).toEqual(detectionResult);
    });

    it('should handle detection result without version', async () => {
      const detectionResult: CliDetectionResult = {
        isInstalled: true,
        cliPath: '/usr/local/bin/qwen',
      };
      vi.spyOn(CliDetector, 'detectQwenCli').mockResolvedValue(detectionResult);

      const result = await cliVersionManager.detectCliVersion();
      expect(result.version).toBeUndefined();
      expect(result.isSupported).toBe(false);
      expect(result.features.supportsSessionList).toBe(false);
      expect(result.features.supportsSessionLoad).toBe(false);
      expect(result.features.supportsSessionSave).toBe(false);
    });

    it('should use cached result when not expired', async () => {
      const detectionResult: CliDetectionResult = {
        isInstalled: true,
        version: '1.0.0',
        cliPath: '/usr/local/bin/qwen',
      };
      const detectSpy = vi
        .spyOn(CliDetector, 'detectQwenCli')
        .mockResolvedValue(detectionResult);

      // First call
      await cliVersionManager.detectCliVersion();
      expect(detectSpy).toHaveBeenCalledTimes(1);

      // Second call should use cache
      await cliVersionManager.detectCliVersion();
      expect(detectSpy).toHaveBeenCalledTimes(1);
    });

    it('should refresh cache when forceRefresh is true', async () => {
      const detectionResult: CliDetectionResult = {
        isInstalled: true,
        version: '1.0.0',
        cliPath: '/usr/local/bin/qwen',
      };
      const detectSpy = vi
        .spyOn(CliDetector, 'detectQwenCli')
        .mockResolvedValue(detectionResult);

      // First call
      await cliVersionManager.detectCliVersion();
      expect(detectSpy).toHaveBeenCalledTimes(1);

      // Second call with forceRefresh should call detect again
      await cliVersionManager.detectCliVersion(true);
      expect(detectSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('clearCache', () => {
    it('should clear the cached version info', async () => {
      const detectionResult: CliDetectionResult = {
        isInstalled: true,
        version: '1.0.0',
        cliPath: '/usr/local/bin/qwen',
      };
      const detectSpy = vi
        .spyOn(CliDetector, 'detectQwenCli')
        .mockResolvedValue(detectionResult);

      // First call
      await cliVersionManager.detectCliVersion();
      expect(detectSpy).toHaveBeenCalledTimes(1);

      // Clear cache
      cliVersionManager.clearCache();

      // Second call should call detect again
      await cliVersionManager.detectCliVersion();
      expect(detectSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('feature support methods', () => {
    it('should return correct session/list support status', async () => {
      const detectionResult: CliDetectionResult = {
        isInstalled: true,
        version: '1.0.0',
        cliPath: '/usr/local/bin/qwen',
      };
      vi.spyOn(CliDetector, 'detectQwenCli').mockResolvedValue(detectionResult);

      const result = await cliVersionManager.supportsSessionList();
      expect(result).toBe(true);
    });

    it('should return correct session/load support status', async () => {
      const detectionResult: CliDetectionResult = {
        isInstalled: true,
        version: '0.1.0',
        cliPath: '/usr/local/bin/qwen',
      };
      vi.spyOn(CliDetector, 'detectQwenCli').mockResolvedValue(detectionResult);

      const result = await cliVersionManager.supportsSessionLoad();
      expect(result).toBe(false);
    });

    it('should return correct session/save support status', async () => {
      const detectionResult: CliDetectionResult = {
        isInstalled: true,
        version: '1.0.0',
        cliPath: '/usr/local/bin/qwen',
      };
      vi.spyOn(CliDetector, 'detectQwenCli').mockResolvedValue(detectionResult);

      // Session save is not yet supported in any version
      const result = await cliVersionManager.supportsSessionSave();
      expect(result).toBe(false);
    });
  });

  describe('MIN_CLI_VERSION_FOR_SESSION_METHODS', () => {
    it('should have the correct minimum version constant', () => {
      expect(MIN_CLI_VERSION_FOR_SESSION_METHODS).toBe('0.2.4');
    });
  });
});
