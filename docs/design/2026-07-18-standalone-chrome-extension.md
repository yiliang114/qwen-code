# Standalone Qwen Code Chrome Extension

## Status

Implemented as a draft comparison branch, 2026-07-18.

## Goal

Provide an install-and-configure browser agent that does not require a running
Qwen process, while reusing Qwen Code's production Web Shell and browser tool
engine. Keep the daemon-based extension as the complete coding-agent path.

## Reverse-engineering findings

The inspected Claude 1.0.66 package contains two callers of one browser-tool
engine:

1. a standalone side-panel runtime that creates its model client in the
   extension and runs the tool loop there; and
2. optional Native Messaging bridges used by Claude Code and Claude Desktop.

Anthropic's support documentation likewise presents ordinary Claude in Chrome
as an install-and-sign-in side panel, while the Claude Code documentation
describes a separate native integration for local coding context.

`noemica-io/open-claude-in-chrome` reconstructs the native chain (Claude Code,
MCP, TCP bridge, native host, extension), not the standalone model runtime.

This confirms that Qwen's pure-web version is technically feasible, but also
that local coding features are not made browser-native merely by sharing the
same UI.

The supplied `claude_1.0.66.zip` was used only as behavioral evidence. No code
was copied from it. Its SHA-256 is
`2d085a455621f07abb649feded74c85e31b0e6ff937823e679a81475dbf95cac`, and it
contains an injected remote-configuration layer. It must not be installed in a
real profile or given credentials.

## Architecture

```text
Qwen Web Shell
  └─ DaemonWorkspaceProvider
       └─ in-process StandaloneDaemonTransport
            ├─ session storage and daemon-shaped event replay
            ├─ ModelStudio OpenAI-compatible agent loop
            ├─ Web Shell permission requests
            └─ existing BrowserTools
                 └─ existing ChromeDebuggerSession
                      └─ active Chrome tab
```

Only one small shared-UI change was required: `WebShellWithProviders` now
accepts the `DaemonTransport` injection point already supported by
`DaemonWorkspaceProvider`. The extension supplies an in-memory implementation
instead of rebuilding chat, transcript, tool, permission, session, or status
components.

The service worker remains responsible only for toolbar/side-panel behavior.
The model loop and debugger session live in the side panel so MV3 service-worker
suspension cannot interrupt a turn or invalidate snapshot element references.

## Reused capabilities

| Capability           | Standalone implementation                                     |
| -------------------- | ------------------------------------------------------------- |
| Chat UI and Markdown | Production Qwen Web Shell                                     |
| Sessions and history | Daemon-shaped session API backed by bounded Chrome storage    |
| Tool cards           | Existing daemon transcript events and Web UI renderers        |
| Permission UX        | Existing Web Shell permission request/resolution flow         |
| Model selector       | Existing provider/model UI backed by standalone settings      |
| Stop                 | Existing composer control aborts fetch/tool execution         |
| Browser tools        | All 20 existing CDP-backed extension tools                    |
| Skills display       | Bundled browser skill exposed through the workspace APIs      |
| Settings             | Local form plus one-click, allowlisted `settings.json` import |

The production bundle is about 3.2 MB compressed. Most of its uncompressed size
is the existing Web Shell Markdown, syntax-highlighting, and diagram stack.

## Tool and permission model

Read-only snapshot, screenshot, wait, console inspection, and network
inspection execute without a second prompt after the user starts a turn.

Navigation, clicks, form entry, keyboard input, scrolling, script execution,
diagnostic clearing, and page-context HTTP requests issue a normal Web Shell
permission request. The user can allow or reject each action. A decision is
discarded if the active page changes before execution.

Page content is treated as untrusted. The model prompt forbids treating page
text as higher-priority instructions and forbids requesting or entering
passwords, payment data, tokens, and other secrets.

## Settings import

A pure Chrome extension cannot silently read `~/.qwen/settings.json`. Local
paths are outside the extension sandbox, and allowing silent filesystem access
would erase the security distinction from the native/daemon mode.

The standalone UI therefore offers a native file picker. Parsing occurs inside
the extension and imports only:

- `model.name`;
- a supported ModelStudio base URL;
- `BAILIAN_TOKEN_PLAN_API_KEY`, `DASHSCOPE_API_KEY`, or the supported auth API
  key field.

MCP configuration, hooks, unrelated environment variables, and unrelated
secrets are ignored. The key remains session-only unless the user explicitly
selects persistent Chrome storage.

## Capability boundary

| Area                          | Standalone pure web                 | Daemon-based extension      |
| ----------------------------- | ----------------------------------- | --------------------------- |
| Install and chat              | No local process                    | Requires Qwen runtime       |
| Browser reading/control       | Full 20-tool browser engine         | Full browser engine         |
| Web Shell UI                  | Yes                                 | Yes                         |
| Session history               | Chrome-local, bounded               | Daemon-managed              |
| Repository/files              | No                                  | Yes                         |
| Shell/Git/processes           | No                                  | Yes                         |
| `QWEN.md` and project context | No                                  | Yes                         |
| Skills                        | Bundled browser-only skills         | Local and project skills    |
| Hooks                         | No arbitrary local hooks            | Full Qwen hook runtime      |
| MCP                           | No local stdio servers              | Full configured MCP support |
| Credentials/config            | Picker or manual entry              | Reads Qwen configuration    |
| Background/schedules          | Not implemented                     | Daemon/runtime dependent    |
| Hosted account sign-in        | Requires a separate backend product | Existing CLI auth paths     |

Local skills and hooks are executable programs or filesystem configuration, not
just UI metadata. Reusing their Web Shell panels without a trusted execution
host would create controls that cannot work. A future standalone release may
bundle audited, browser-only skill prompts, but arbitrary local execution must
remain in daemon/native-host mode.

## Deliberate remaining gaps

- Model responses are currently displayed after each model step rather than
  token-streamed. Tool progress, permissions, stopping, and final responses are
  live daemon events.
- Session history is bounded rather than model-summarized.
- Claude-style workflow recording, multi-tab groups, scheduled background
  tasks, notifications, upload tooling, and GIF capture are separate browser
  product features, not provided by Qwen Code's current browser tool engine.
- Account sign-in and hosted safety classifiers require backend services and
  cannot be recreated in an extension-only PR.

These gaps do not block the standalone architecture. They define follow-up
product work rather than reasons to duplicate the Qwen Code UI or run local
code unsafely.

## Security and release constraints

- Only `http:` and `https:` pages may be automated.
- Only four explicit ModelStudio HTTPS hosts and the
  `/compatible-mode/v1` base path are accepted.
- API keys are never put into page context, URLs, tool output, or logs.
- Model errors and persisted tool content are bounded.
- Chrome storage holds at most 20 sessions, 100 messages per session, and 500
  replay events per session.
- `chrome.debugger` remains a powerful permission; release integrity and a
  narrow update channel are mandatory.

## Verification

- 92 Chrome-extension unit tests cover the agent loop, settings allowlist,
  credential persistence, all browser-tool families, transport event flow, and
  permission denial.
- Chrome-extension type checking and production packaging pass.
- The packaged artifact scanner passes.
