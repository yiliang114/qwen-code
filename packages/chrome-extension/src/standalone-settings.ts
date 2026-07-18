/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { validateModelBaseUrl, type ModelConfig } from './standalone-agent.js';

export const DEFAULT_BASE_URL =
  'https://dashscope.aliyuncs.com/compatible-mode/v1';
export const DEFAULT_MODEL = 'qwen3-coder-plus';
export const TOKEN_PLAN_BASE_URL =
  'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1';

export interface StoredStandaloneSettings {
  baseUrl?: string;
  model?: string;
  rememberKey?: boolean;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function parseQwenSettings(value: unknown): Partial<ModelConfig> {
  const settings = record(value);
  const model = record(settings['model']);
  const env = record(settings['env']);
  const auth = record(record(settings['security'])['auth']);
  const tokenPlan = record(record(settings['providerMetadata'])['token-plan']);
  const selectedModel = string(model['name']);
  const openAiProviders = record(settings['modelProviders'])['openai'];
  const provider = Array.isArray(openAiProviders)
    ? openAiProviders
        .map(record)
        .find(
          (candidate) =>
            string(candidate['id']) === selectedModel ||
            string(candidate['name']) === selectedModel,
        )
    : undefined;
  const providerEnvKey = string(provider?.['envKey']);
  const apiKey =
    (providerEnvKey ? string(env[providerEnvKey]) : undefined) ??
    string(env['BAILIAN_TOKEN_PLAN_API_KEY']) ??
    string(env['DASHSCOPE_API_KEY']) ??
    string(auth['apiKey']);
  const rawBaseUrl =
    string(provider?.['baseUrl']) ??
    string(tokenPlan['baseUrl']) ??
    string(auth['baseUrl']) ??
    string(model['baseUrl']) ??
    (env['BAILIAN_TOKEN_PLAN_API_KEY'] ? TOKEN_PLAN_BASE_URL : undefined);

  return {
    ...(apiKey ? { apiKey } : {}),
    ...(selectedModel ? { model: selectedModel } : {}),
    ...(rawBaseUrl ? { baseUrl: validateModelBaseUrl(rawBaseUrl) } : {}),
  };
}
