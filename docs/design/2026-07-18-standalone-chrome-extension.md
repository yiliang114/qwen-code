# Standalone Qwen Code Chrome Extension

## Status

Prototype design, 2026-07-18.

## Goal

Build a clean-room, browser-only Qwen agent as a comparison point for the
existing `qwen serve` Chrome extension. The standalone extension must run its
model loop and browser tools inside Chrome, without a Qwen CLI, daemon, native
messaging host, or external MCP process.

This is a browser agent, not a browser-hosted replacement for the full Qwen
Code CLI.

## Evidence

### Confirmed

- The inspected Claude 1.0.66 package contains a standalone side-panel agent
  loop. It creates an Anthropic client in the extension, requests streamed
  messages, executes returned tool calls through extension-local browser tools,
  appends tool results, and continues until the model returns text.
- The same package probes the native messaging hosts for Claude Code and
  Claude Desktop. Native requests call the same internal browser-tool
  dispatcher used by the standalone path.
- Anthropic's support documentation describes installing Claude in Chrome,
  signing in, and chatting in the side panel without first starting Claude
  Code. Its Claude Code documentation separately describes the native messaging
  host installed for local integration.
- `noemica-io/open-claude-in-chrome` implements the native path, not the
  standalone path. Its chain is Claude Code to a stdio MCP server, a TCP
  bridge, a native messaging host, and finally the extension.
- Qwen Code's current Chrome extension keeps the agent loop in `qwen serve`.
  The extension displays the daemon Web UI and exposes browser tools to the
  daemon.
- The pending native-tools branch already implements CDP-backed snapshot,
  navigation, click, fill, keyboard, scroll, wait, screenshot, console, network,
  evaluation, and page-fetch tools in the extension.
- Qwen OAuth's free tier was discontinued on 2026-04-15. Current Qwen Code
  onboarding uses Alibaba ModelStudio Coding Plan or API keys.
- Alibaba ModelStudio provides an OpenAI-compatible chat-completions API and
  documents function calling. A Chrome extension with the appropriate host
  permission can call that HTTPS endpoint directly.

### Inferred

- Claude's two observed behaviors are two callers of one extension tool engine,
  rather than two independently distributed extensions.
- A standalone Qwen browser agent is technically feasible with no backend
  changes when the user supplies a ModelStudio API key.
- Claude-like account sign-in requires a supported browser-safe authentication
  product and backend. It cannot be recreated solely in the extension now that
  the prior Qwen OAuth service is discontinued.
- Coding Plan may be technically compatible with the prototype's requests, but
  its documented usage restrictions require a product/policy decision before
  the extension should advertise it as a supported credential.

### Qwen mapping

| Claude behavior                | Qwen implementation                                                   |
| ------------------------------ | --------------------------------------------------------------------- |
| Side-panel model loop          | OpenAI-compatible `/chat/completions` loop in the side panel          |
| Anthropic tool schemas         | Existing Qwen browser-tool schemas converted to OpenAI function tools |
| Extension-local tool execution | Existing `BrowserTools` and `ChromeDebuggerSession`                   |
| Claude account token           | User-provided ModelStudio API key for the prototype                   |
| Per-action permission          | Side-panel confirmation before state-changing tools                   |
| Native Claude Code integration | Existing `qwen serve` extension remains the full Qwen Code path       |

## Necessity gate

The feature is worth prototyping because it materially changes onboarding:
installing the extension is sufficient to start a browser-only agent after
entering a model credential. It also provides a concrete comparison against the
daemon architecture.

The standalone path must not replace the daemon path. It cannot provide:

- local filesystem, shell, Git, or process access;
- repository context, `QWEN.md`, skills, or local project configuration;
- stdio MCP servers or other local subprocess integrations;
- secure reuse of credentials stored by the Qwen CLI;
- local file upload by absolute path.

Those are defining Qwen Code capabilities, not implementation details.

## Prototype architecture

```text
Side panel
  ├─ chat UI and in-memory conversation
  ├─ ModelStudio HTTPS request
  ├─ OpenAI-compatible tool loop
  └─ BrowserTools
       └─ ChromeDebuggerSession
            └─ active Chrome tab
```

The tool executor lives in the side-panel context. This avoids depending on an
MV3 service worker staying alive across a slow model response, and preserves
element references between snapshot and action calls.

The service worker only configures toolbar-click behavior.

## Initial scope

The model receives these tools:

- `take_snapshot`
- `navigate_page`
- `reload_page`
- `go_back`
- `go_forward`
- `click`
- `fill`
- `fill_form`
- `press_key`
- `scroll_page`
- `wait_for`

The prototype deliberately withholds screenshot, arbitrary JavaScript,
console, network, and page-context HTTP tools. They can be evaluated after the
basic loop is proven.

Requests are non-streaming for the prototype. Streaming improves perceived
latency but does not affect feasibility and would add a second parser before the
core architecture is validated.

## Credentials and endpoints

The default endpoint is the Beijing ModelStudio OpenAI-compatible endpoint:

`https://dashscope.aliyuncs.com/compatible-mode/v1`

The endpoint remains editable across the fixed Beijing, international, and US
DashScope hosts, but arbitrary `aliyuncs.com` subdomains are rejected. The
manifest grants access to those same exact hosts and no arbitrary Internet
request access.

The API key is stored in `chrome.storage.session` by default and disappears
when Chrome exits. The user may explicitly opt into persistence in
`chrome.storage.local`. Chrome extension storage is not a hardware-backed
secret store, so the UI must state this limitation.

## Permission model

The user sending a prompt authorizes read-only browser inspection for that
agent turn. State-changing tools always require a browser confirmation that
includes the active origin.

This is intentionally smaller than Claude's site/tool permission system. A
production version should add durable per-origin decisions, clear domain-change
boundaries, and a visible session stop control.

## Security boundaries

- Only `http:` and `https:` pages may be automated.
- Only the three allowlisted DashScope HTTPS hosts and the
  `/compatible-mode/v1` base path are accepted.
- The API key is never placed in tool output, page context, URL parameters, or
  logs.
- Model errors shown in the UI are truncated.
- Arbitrary JavaScript, network response bodies, console messages, and
  page-context fetch are excluded from the model's tool list.
- The extension has the powerful Chrome debugger permission. A compromised
  extension release can still read and control authenticated pages, so release
  integrity and a narrow update channel remain critical.

## Supplied Claude package warning

The inspected `claude_1.0.66.zip` has SHA-256
`2d085a455621f07abb649feded74c85e31b0e6ff937823e679a81475dbf95cac`.
It is not a clean official artifact. It contains an injected request layer that
periodically retrieves remote configuration from
`openclaude.111724.xyz`, can redirect API and OAuth requests, and modifies
telemetry and UI behavior. Because the extension also requests all-sites,
debugger, identity, and native-messaging permissions, it must not be installed
in a real profile or given credentials.

No code from that package is copied into this prototype.

## Production decision points

1. Decide whether this is branded as Qwen Code or as a narrower Qwen Browser
   Agent.
2. Provide a supported sign-in/credential service if install-and-login
   onboarding is required.
3. Confirm whether Coding Plan permits this interactive browser-agent client.
4. Add per-origin and per-tool permission persistence.
5. Add streaming, cancellation, context compaction, and recovery only after the
   basic product path is validated.
6. Decide whether standalone and daemon modes ship in one extension or as two
   store listings. One extension reduces duplicated permissions and tools, while
   two listings make the trust and capability boundary clearer.
