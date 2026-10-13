# Qwen Browser Agent — standalone

This branch adds a browser-only companion to the daemon-based Qwen Code Chrome
extension. It reuses Qwen Code's Web Shell, daemon event protocol, permission
UI, and Chrome debugger tools while running the model/tool loop entirely inside
Chrome. It does not require `qwen serve`, Native Messaging, or an external MCP
process.

It is a browser agent, not a browser-hosted replacement for the Qwen Code CLI.
Local filesystem, shell, Git, repository context, local MCP servers, hooks, and
project skills remain exclusive to the daemon-based extension.

## Build and load

```bash
npm run build
```

Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and
select `dist/extension`.

The first launch accepts:

- a Qwen `settings.json` selected with **Import settings.json**; or
- an Alibaba ModelStudio endpoint, model name, and API key entered manually.

Chrome extensions cannot silently read arbitrary local files. The file picker
is therefore the closest browser-only equivalent to reading the local Qwen
configuration. The selected file is parsed locally, and only the active model,
supported endpoint, and supported API key are imported. MCP definitions and
unrelated environment variables are ignored.

The API key is stored in `chrome.storage.session` by default. Selecting
**Remember the API key after Chrome exits** moves it to
`chrome.storage.local`, which is persistent but not a hardware-backed secret
store.

## Reused Qwen Code experience

- the complete Web Shell chat surface, Markdown rendering, tool cards, sidebar,
  model selector, stop control, status bar, and responsive layout;
- the daemon SDK's session, replay, provider, tool, skill, and permission event
  shapes through an in-process browser transport;
- persisted browser-chat sessions, with bounded history and event replay;
- the existing `BrowserTools` and `ChromeDebuggerSession` implementation;
- the existing Web Shell permission drawer for state-changing or sensitive
  tools.

## Browser tools

The model receives all 20 existing extension tools:

- accessibility snapshot and screenshot;
- navigation, reload, back, and forward;
- click, fill, multi-field form fill, keyboard, scroll, and wait;
- JavaScript evaluation;
- console list, detail, and clear;
- network request list, detail/body, and clear;
- page-context HTTP requests.

Snapshot, screenshot, wait, and read-only console/network inspection run
without an extra prompt. Navigation, page mutation, JavaScript, clearing
diagnostics, and HTTP requests require explicit approval in the Web Shell.
Approval is invalidated if the page changes while the decision is pending.

The tools operate through `chrome.debugger`, so Chrome displays its debugger
banner while a tab is attached.

## Pure-web boundary

The standalone path cannot safely reuse functionality that depends on the local
Qwen process:

- filesystem, shell, Git, repository context, and `QWEN.md`;
- local skill discovery or execution;
- shell-based hooks and policies;
- stdio MCP servers and local subprocesses;
- CLI credentials or silent local configuration access;
- daemon background jobs and schedules.

The standalone transport advertises a built-in browser skill because its
instructions and tools are bundled in the extension. Adding more bundled,
reviewed browser-only skills is possible. Executing arbitrary local skills or
hooks would require the daemon/native-host mode.

## Verify and package

```bash
npm test
npm run typecheck
npm run package
```

The packaged artifact is `chrome-extension.zip`.
