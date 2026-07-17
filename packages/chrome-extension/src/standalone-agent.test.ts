/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { runAgent, validateModelBaseUrl } from './standalone-agent.js';
import type { BrowserToolDefinition } from './background/browser-mcp/server.js';

const tools: BrowserToolDefinition[] = [
  {
    name: 'take_snapshot',
    description: 'Read the page.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
];

describe('runAgent', () => {
  it('executes a tool call and sends its result back to the model', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: 'call-1',
                      type: 'function',
                      function: {
                        name: 'take_snapshot',
                        arguments: '{}',
                      },
                    },
                  ],
                },
              },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'The page says hello.' } }],
          }),
        ),
      );
    const callTool = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'Page: Example\ntext "hello"' }],
    });

    const result = await runAgent({
      config: {
        apiKey: 'secret-key',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        model: 'qwen3-coder-plus',
      },
      messages: [{ role: 'user', content: 'Summarize this page' }],
      tools,
      callTool,
      fetchImpl,
    });

    expect(callTool).toHaveBeenCalledWith('take_snapshot', {});
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(fetchImpl.mock.calls[1]![1]!.body as string).messages,
    ).toContainEqual({
      role: 'tool',
      tool_call_id: 'call-1',
      content: 'Page: Example\ntext "hello"',
    });
    expect(result.text).toBe('The page says hello.');
  });

  it('does not execute a tool that was not provided to the model', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  tool_calls: [
                    {
                      id: 'call-1',
                      type: 'function',
                      function: {
                        name: 'evaluate_script',
                        arguments: '{"expression":"document.cookie"}',
                      },
                    },
                  ],
                },
              },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'That tool is unavailable.' } }],
          }),
        ),
      );
    const callTool = vi.fn();

    await runAgent({
      config: {
        apiKey: 'secret-key',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        model: 'qwen3-coder-plus',
      },
      messages: [{ role: 'user', content: 'Read my cookies' }],
      tools,
      callTool,
      fetchImpl,
    });

    expect(callTool).not.toHaveBeenCalled();
    expect(
      JSON.parse(fetchImpl.mock.calls[1]![1]!.body as string).messages,
    ).toContainEqual({
      role: 'tool',
      tool_call_id: 'call-1',
      content: "Tool error: Tool 'evaluate_script' is unavailable",
    });
  });

  it('does not execute later tools after the user stops the run', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    id: 'call-1',
                    type: 'function',
                    function: {
                      name: 'take_snapshot',
                      arguments: '{}',
                    },
                  },
                  {
                    id: 'call-2',
                    type: 'function',
                    function: {
                      name: 'take_snapshot',
                      arguments: '{}',
                    },
                  },
                ],
              },
            },
          ],
        }),
      ),
    );
    const callTool = vi.fn().mockImplementation(async () => {
      controller.abort();
      return { content: [{ type: 'text', text: 'Page content' }] };
    });

    const messages = [{ role: 'user' as const, content: 'Read it twice' }];
    await expect(
      runAgent({
        config: {
          apiKey: 'secret-key',
          baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
          model: 'qwen3-coder-plus',
        },
        messages,
        tools,
        callTool,
        fetchImpl,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(messages.slice(-2)).toEqual([
      {
        role: 'tool',
        tool_call_id: 'call-1',
        content: 'Page content',
      },
      {
        role: 'tool',
        tool_call_id: 'call-2',
        content: 'User stopped the run before this action.',
      },
    ]);
  });

  it('preserves completed tool history when the next model request fails', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  tool_calls: [
                    {
                      id: 'call-1',
                      type: 'function',
                      function: {
                        name: 'take_snapshot',
                        arguments: '{}',
                      },
                    },
                  ],
                },
              },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response('temporary failure', { status: 503 }),
      );
    const messages = [{ role: 'user' as const, content: 'Read this page' }];

    await expect(
      runAgent({
        config: {
          apiKey: 'secret-key',
          baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
          model: 'qwen3-coder-plus',
        },
        messages,
        tools,
        callTool: async () => ({
          content: [{ type: 'text', text: 'Page content' }],
        }),
        fetchImpl,
      }),
    ).rejects.toThrow('503');
    expect(messages.at(-1)).toEqual({
      role: 'tool',
      tool_call_id: 'call-1',
      content: 'Page content',
    });
  });

  it('redacts and caps provider error bodies', async () => {
    const secret = 'secret-key';
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(`${secret}-${'x'.repeat(1_000)}`, { status: 401 }),
      );

    await expect(
      runAgent({
        config: {
          apiKey: secret,
          baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
          model: 'qwen3-coder-plus',
        },
        messages: [{ role: 'user', content: 'Hello' }],
        tools,
        callTool: vi.fn(),
        fetchImpl,
      }),
    ).rejects.toSatisfy((error: Error) => {
      expect(error.message).toContain('[REDACTED]');
      expect(error.message).not.toContain(secret);
      expect(error.message.length).toBeLessThan(900);
      return true;
    });
  });

  it('stops after the configured number of model steps', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  tool_calls: [
                    {
                      id: 'call-1',
                      type: 'function',
                      function: {
                        name: 'take_snapshot',
                        arguments: '{}',
                      },
                    },
                  ],
                },
              },
            ],
          }),
        ),
    );

    await expect(
      runAgent({
        config: {
          apiKey: 'secret-key',
          baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
          model: 'qwen3-coder-plus',
        },
        messages: [{ role: 'user', content: 'Keep reading' }],
        tools,
        callTool: async () => ({
          content: [{ type: 'text', text: 'Page content' }],
        }),
        fetchImpl,
        maxSteps: 2,
      }),
    ).rejects.toThrow('stopped after 2 model steps');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('validateModelBaseUrl', () => {
  it('allows ModelStudio HTTPS endpoints', () => {
    expect(
      validateModelBaseUrl(
        'https://dashscope.aliyuncs.com/compatible-mode/v1/',
      ),
    ).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1');
  });

  it('rejects endpoints outside aliyuncs.com', () => {
    expect(() => validateModelBaseUrl('https://example.com/v1')).toThrowError(
      'supported ModelStudio',
    );
  });

  it('rejects unrecognized aliyuncs.com subdomains', () => {
    expect(() =>
      validateModelBaseUrl(
        'https://attacker-service.aliyuncs.com/compatible-mode/v1',
      ),
    ).toThrowError('supported ModelStudio');
  });

  it.each([
    'http://dashscope.aliyuncs.com/compatible-mode/v1',
    'https://user:pass@dashscope.aliyuncs.com/compatible-mode/v1',
    'https://dashscope.aliyuncs.com/compatible-mode/v1?target=other',
    'https://dashscope.aliyuncs.com/compatible-mode/v1#token',
    'https://dashscope.aliyuncs.com/other/v1',
  ])('rejects unsafe base URL %s', (url) => {
    expect(() => validateModelBaseUrl(url)).toThrow();
  });
});
