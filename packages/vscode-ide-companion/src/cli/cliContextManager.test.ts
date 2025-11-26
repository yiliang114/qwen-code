/**
 * @license
 * Copyright 2025 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CliContextManager } from './cliContextManager.js';
import type { CliVersionInfo } from './cliVersionManager.js';

describe('CliContextManager', () => {
  let cliContextManager: CliContextManager;

  beforeEach(() => {
    // Get a fresh instance for each test
    cliContextManager = CliContextManager.getInstance();
    cliContextManager.clearContext();
  });

  describe('getInstance', () => {
    it('should return a singleton instance', () => {
      const instance1 = CliContextManager.getInstance();
      const instance2 = CliContextManager.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('setCurrentVersionInfo', () => {
    it('should set the current version info', () => {
      const versionInfo: CliVersionInfo = {
        version: '1.0.0',
        isSupported: true,
        features: {
          supportsSessionList: true,
          supportsSessionLoad: true,
          supportsSessionSave: false,
        },
        detectionResult: {
          isInstalled: true,
        },
      };

      cliContextManager.setCurrentVersionInfo(versionInfo);
      const result = cliContextManager.getCurrentVersionInfo();
      expect(result).toEqual(versionInfo);
    });

    it('should handle undefined version info', () => {
      cliContextManager.setCurrentVersionInfo(
        null as unknown as CliVersionInfo,
      );
      const result = cliContextManager.getCurrentVersionInfo();
      expect(result).toBeNull();
    });
  });

  describe('getCurrentVersionInfo', () => {
    it('should return null when no version info is set', () => {
      const result = cliContextManager.getCurrentVersionInfo();
      expect(result).toBeNull();
    });

    it('should return the set version info', () => {
      const versionInfo: CliVersionInfo = {
        version: '1.0.0',
        isSupported: true,
        features: {
          supportsSessionList: true,
          supportsSessionLoad: true,
          supportsSessionSave: false,
        },
        detectionResult: {
          isInstalled: true,
        },
      };

      cliContextManager.setCurrentVersionInfo(versionInfo);
      const result = cliContextManager.getCurrentVersionInfo();
      expect(result).toEqual(versionInfo);
    });
  });

  describe('getCurrentFeatures', () => {
    it('should return default features when no version info is set', () => {
      const features = cliContextManager.getCurrentFeatures();
      expect(features).toEqual({
        supportsSessionList: false,
        supportsSessionLoad: false,
        supportsSessionSave: false,
      });
    });

    it('should return the features from version info when set', () => {
      const versionInfo: CliVersionInfo = {
        version: '1.0.0',
        isSupported: true,
        features: {
          supportsSessionList: true,
          supportsSessionLoad: false,
          supportsSessionSave: true,
        },
        detectionResult: {
          isInstalled: true,
        },
      };

      cliContextManager.setCurrentVersionInfo(versionInfo);
      const features = cliContextManager.getCurrentFeatures();
      expect(features).toEqual(versionInfo.features);
    });
  });

  describe('feature support methods', () => {
    it('should correctly report session/list support', () => {
      const versionInfo: CliVersionInfo = {
        version: '1.0.0',
        isSupported: true,
        features: {
          supportsSessionList: true,
          supportsSessionLoad: false,
          supportsSessionSave: false,
        },
        detectionResult: {
          isInstalled: true,
        },
      };

      cliContextManager.setCurrentVersionInfo(versionInfo);
      expect(cliContextManager.supportsSessionList()).toBe(true);
      expect(cliContextManager.supportsSessionLoad()).toBe(false);
      expect(cliContextManager.supportsSessionSave()).toBe(false);
    });

    it('should return false for all features when no version info is set', () => {
      expect(cliContextManager.supportsSessionList()).toBe(false);
      expect(cliContextManager.supportsSessionLoad()).toBe(false);
      expect(cliContextManager.supportsSessionSave()).toBe(false);
    });
  });

  describe('isCliInstalled', () => {
    it('should return false when no version info is set', () => {
      expect(cliContextManager.isCliInstalled()).toBe(false);
    });

    it('should return true when CLI is installed', () => {
      const versionInfo: CliVersionInfo = {
        version: '1.0.0',
        isSupported: true,
        features: {
          supportsSessionList: false,
          supportsSessionLoad: false,
          supportsSessionSave: false,
        },
        detectionResult: {
          isInstalled: true,
        },
      };

      cliContextManager.setCurrentVersionInfo(versionInfo);
      expect(cliContextManager.isCliInstalled()).toBe(true);
    });

    it('should return false when CLI is not installed', () => {
      const versionInfo: CliVersionInfo = {
        version: undefined,
        isSupported: false,
        features: {
          supportsSessionList: false,
          supportsSessionLoad: false,
          supportsSessionSave: false,
        },
        detectionResult: {
          isInstalled: false,
        },
      };

      cliContextManager.setCurrentVersionInfo(versionInfo);
      expect(cliContextManager.isCliInstalled()).toBe(false);
    });
  });

  describe('getCliVersion', () => {
    it('should return undefined when no version info is set', () => {
      expect(cliContextManager.getCliVersion()).toBeUndefined();
    });

    it('should return the CLI version when set', () => {
      const version = '1.2.3';
      const versionInfo: CliVersionInfo = {
        version,
        isSupported: true,
        features: {
          supportsSessionList: false,
          supportsSessionLoad: false,
          supportsSessionSave: false,
        },
        detectionResult: {
          isInstalled: true,
        },
      };

      cliContextManager.setCurrentVersionInfo(versionInfo);
      expect(cliContextManager.getCliVersion()).toBe(version);
    });
  });

  describe('isCliVersionSupported', () => {
    it('should return false when no version info is set', () => {
      expect(cliContextManager.isCliVersionSupported()).toBe(false);
    });

    it('should return true when CLI version is supported', () => {
      const versionInfo: CliVersionInfo = {
        version: '1.0.0',
        isSupported: true,
        features: {
          supportsSessionList: false,
          supportsSessionLoad: false,
          supportsSessionSave: false,
        },
        detectionResult: {
          isInstalled: true,
        },
      };

      cliContextManager.setCurrentVersionInfo(versionInfo);
      expect(cliContextManager.isCliVersionSupported()).toBe(true);
    });

    it('should return false when CLI version is not supported', () => {
      const versionInfo: CliVersionInfo = {
        version: '0.1.0',
        isSupported: false,
        features: {
          supportsSessionList: false,
          supportsSessionLoad: false,
          supportsSessionSave: false,
        },
        detectionResult: {
          isInstalled: true,
        },
      };

      cliContextManager.setCurrentVersionInfo(versionInfo);
      expect(cliContextManager.isCliVersionSupported()).toBe(false);
    });
  });

  describe('clearContext', () => {
    it('should clear the current version info', () => {
      const versionInfo: CliVersionInfo = {
        version: '1.0.0',
        isSupported: true,
        features: {
          supportsSessionList: true,
          supportsSessionLoad: true,
          supportsSessionSave: false,
        },
        detectionResult: {
          isInstalled: true,
        },
      };

      cliContextManager.setCurrentVersionInfo(versionInfo);
      expect(cliContextManager.getCurrentVersionInfo()).toEqual(versionInfo);

      cliContextManager.clearContext();
      expect(cliContextManager.getCurrentVersionInfo()).toBeNull();
      expect(cliContextManager.isCliInstalled()).toBe(false);
      expect(cliContextManager.isCliVersionSupported()).toBe(false);
    });
  });
});
