/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsIcon } from 'lucide-react';
import { WebShellWithProviders } from '@qwen-code/web-shell';
import { StandaloneDaemonTransport } from './standalone-transport.js';
import {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  parseQwenSettings,
  type StoredStandaloneSettings,
} from './standalone-settings.js';
import { validateModelBaseUrl, type ModelConfig } from './standalone-agent.js';
import './sidepanel.css';

const SETTINGS_KEY = 'qwen.standalone.settings';
const API_KEY = 'qwen.standalone.apiKey';

interface ConfigDialogProps {
  config?: ModelConfig;
  initial: boolean;
  rememberKey: boolean;
  onClose(): void;
  onSave(config: ModelConfig, rememberKey: boolean): Promise<void>;
}

interface LoadedConfig {
  config: ModelConfig;
  rememberKey: boolean;
}

async function loadConfig(): Promise<LoadedConfig | undefined> {
  const local = await chrome.storage.local.get([SETTINGS_KEY, API_KEY]);
  const settings =
    (local[SETTINGS_KEY] as StoredStandaloneSettings | undefined) ?? {};
  const apiKey = settings.rememberKey
    ? local[API_KEY]
    : (await chrome.storage.session.get(API_KEY))[API_KEY];
  if (typeof apiKey !== 'string' || !apiKey.trim()) return undefined;
  return {
    config: {
      apiKey: apiKey.trim(),
      baseUrl: validateModelBaseUrl(settings.baseUrl ?? DEFAULT_BASE_URL),
      model: settings.model?.trim() || DEFAULT_MODEL,
    },
    rememberKey: settings.rememberKey === true,
  };
}

async function storeConfig(
  config: ModelConfig,
  rememberKey: boolean,
): Promise<void> {
  await chrome.storage.local.set({
    [SETTINGS_KEY]: {
      baseUrl: config.baseUrl,
      model: config.model,
      rememberKey,
    } satisfies StoredStandaloneSettings,
  });
  if (rememberKey) {
    await chrome.storage.local.set({ [API_KEY]: config.apiKey });
    await chrome.storage.session.remove(API_KEY);
  } else {
    await chrome.storage.session.set({ [API_KEY]: config.apiKey });
    await chrome.storage.local.remove(API_KEY);
  }
}

function ConfigDialog({
  config,
  initial,
  rememberKey: initialRememberKey,
  onClose,
  onSave,
}: ConfigDialogProps) {
  const [baseUrl, setBaseUrl] = useState(config?.baseUrl ?? DEFAULT_BASE_URL);
  const [model, setModel] = useState(config?.model ?? DEFAULT_MODEL);
  const [apiKey, setApiKey] = useState(config?.apiKey ?? '');
  const [rememberKey, setRememberKey] = useState(initialRememberKey);
  const [status, setStatus] = useState('');

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setStatus('Saving…');
    try {
      const nextApiKey = apiKey.trim();
      const nextModel = model.trim();
      if (!nextApiKey) throw new Error('Enter a ModelStudio API key');
      if (!nextModel) throw new Error('Enter a model name');
      await onSave(
        {
          apiKey: nextApiKey,
          baseUrl: validateModelBaseUrl(baseUrl.trim()),
          model: nextModel,
        },
        rememberKey,
      );
      setStatus('');
      onClose();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function importSettings(file: File | undefined): Promise<void> {
    if (!file) return;
    setStatus('Importing…');
    try {
      const imported = parseQwenSettings(
        JSON.parse(await file.text()) as unknown,
      );
      if (imported.baseUrl) setBaseUrl(imported.baseUrl);
      if (imported.model) setModel(imported.model);
      if (imported.apiKey) setApiKey(imported.apiKey);
      setStatus(
        imported.apiKey
          ? 'Imported model settings and API key'
          : 'Imported model settings; API key was not stored in this file',
      );
    } catch (error) {
      setStatus(
        `Import failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return (
    <div className="standalone-config-backdrop" role="presentation">
      <section
        className="standalone-config"
        role="dialog"
        aria-modal="true"
        aria-labelledby="standalone-config-title"
      >
        <header>
          <div>
            <span className="standalone-badge">Standalone</span>
            <h1 id="standalone-config-title">Qwen Browser Agent</h1>
            <p>Runs entirely in Chrome. No qwen serve process is required.</p>
          </div>
          {!initial && (
            <button
              className="standalone-icon-button"
              type="button"
              aria-label="Close settings"
              onClick={onClose}
            >
              ×
            </button>
          )}
        </header>
        <form id="settings-form" onSubmit={(event) => void submit(event)}>
          <label>
            Qwen settings
            <span className="standalone-file">
              Import settings.json
              <input
                type="file"
                accept=".json,application/json"
                onChange={(event) => {
                  void importSettings(event.currentTarget.files?.[0]);
                  event.currentTarget.value = '';
                }}
              />
            </span>
          </label>
          <label>
            ModelStudio base URL
            <input
              id="base-url"
              type="url"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.currentTarget.value)}
              required
            />
          </label>
          <label>
            Model
            <input
              id="model"
              value={model}
              onChange={(event) => setModel(event.currentTarget.value)}
              required
            />
          </label>
          <label>
            API key
            <input
              id="api-key"
              type="password"
              value={apiKey}
              autoComplete="off"
              onChange={(event) => setApiKey(event.currentTarget.value)}
              required
            />
          </label>
          <label className="standalone-check">
            <input
              id="remember-key"
              type="checkbox"
              checked={rememberKey}
              onChange={(event) => setRememberKey(event.currentTarget.checked)}
            />
            Remember the API key after Chrome exits
          </label>
          <p className="standalone-notice">
            The selected file is parsed locally. Only model, endpoint, and the
            supported API key are imported. Page content needed for a task is
            sent to the configured endpoint.
          </p>
          <div className="standalone-actions">
            <span role="status">{status}</span>
            <button type="submit">Save and continue</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function Sidepanel() {
  const [config, setConfig] = useState<ModelConfig>();
  const [rememberKey, setRememberKey] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [sessionId, setSessionId] = useState<string>();
  const configRef = useRef<ModelConfig | undefined>(undefined);
  const rememberKeyRef = useRef(false);
  configRef.current = config;
  rememberKeyRef.current = rememberKey;
  const transport = useMemo(
    () =>
      new StandaloneDaemonTransport({
        getConfig: async () => {
          const current = configRef.current;
          if (!current) throw new Error('Configure ModelStudio to continue');
          return current;
        },
        setModel: async (model) => {
          const current = configRef.current;
          if (!current) return;
          const next = { ...current, model };
          configRef.current = next;
          setConfig(next);
          await storeConfig(next, rememberKeyRef.current);
        },
      }),
    [],
  );

  useEffect(() => {
    void loadConfig()
      .then((value) => {
        setConfig(value?.config);
        setRememberKey(value?.rememberKey ?? false);
        setShowSettings(!value);
      })
      .catch(() => setShowSettings(true))
      .finally(() => setLoaded(true));
    return () => transport.dispose();
  }, [transport]);

  if (!loaded) return null;

  return (
    <>
      {config && (
        <WebShellWithProviders
          baseUrl="https://standalone.invalid"
          transport={transport}
          sessionId={sessionId}
          onSessionIdChange={setSessionId}
          sidebar={{ enabled: true, defaultCollapsed: true, footer: false }}
          composerToolbarActions={['model', 'commands']}
          builtinAtProviders={false}
          messageTurnOutputs={[]}
          compactThinking
          markdownTableMode="advanced"
          hiddenSlashCommands={[
            'plan',
            'btw',
            'delete',
            'release',
            'auth',
            'approval-mode',
            'mcp',
            'memory',
            'agents',
            'goal',
            'tasks',
            'recap',
            'rewind',
            'branch',
            'fork',
            'settings',
            'schedule',
            'extensions',
          ]}
          bottomStatusItems={[
            {
              id: 'standalone-settings',
              label: (
                <span className="standalone-settings-label">
                  <SettingsIcon size={14} />
                  Settings
                </span>
              ),
              title: 'Standalone model settings',
              onClick: () => setShowSettings(true),
            },
          ]}
          composerPlaceholders={{
            idle: 'Ask Qwen to read or operate the current tab…',
          }}
        />
      )}
      {showSettings && (
        <ConfigDialog
          config={config}
          initial={!config}
          rememberKey={rememberKey}
          onClose={() => setShowSettings(false)}
          onSave={async (next, nextRememberKey) => {
            await storeConfig(next, nextRememberKey);
            configRef.current = next;
            rememberKeyRef.current = nextRememberKey;
            setConfig(next);
            setRememberKey(nextRememberKey);
          }}
        />
      )}
    </>
  );
}

createRoot(document.getElementById('root')!).render(<Sidepanel />);
