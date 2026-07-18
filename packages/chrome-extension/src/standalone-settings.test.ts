/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  parseQwenSettings,
  TOKEN_PLAN_BASE_URL,
} from './standalone-settings.js';

describe('parseQwenSettings', () => {
  it('imports only the active model and Token Plan credentials', () => {
    expect(
      parseQwenSettings({
        model: { name: 'glm-5.2' },
        env: {
          BAILIAN_TOKEN_PLAN_API_KEY: 'sk-token',
          UNRELATED_SECRET: 'do-not-import',
        },
        mcpServers: { private: { token: 'do-not-import' } },
      }),
    ).toEqual({
      apiKey: 'sk-token',
      baseUrl: TOKEN_PLAN_BASE_URL,
      model: 'glm-5.2',
    });
  });

  it('uses an explicitly configured supported endpoint', () => {
    expect(
      parseQwenSettings({
        modelProviders: {
          openai: [
            {
              id: 'qwen3-coder-plus',
              baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/',
              envKey: 'CUSTOM_DASHSCOPE_KEY',
            },
          ],
        },
        model: {
          name: 'qwen3-coder-plus',
        },
        env: { CUSTOM_DASHSCOPE_KEY: 'sk-modelstudio' },
      }),
    ).toEqual({
      apiKey: 'sk-modelstudio',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen3-coder-plus',
    });
  });

  it('supports deprecated auth fields without importing other env values', () => {
    expect(
      parseQwenSettings({
        model: { name: 'qwen3-coder-plus' },
        security: {
          auth: {
            apiKey: 'sk-legacy',
            baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
          },
        },
        env: { PRIVATE_TOKEN: 'do-not-import' },
      }),
    ).toEqual({
      apiKey: 'sk-legacy',
      baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
      model: 'qwen3-coder-plus',
    });
  });
});
