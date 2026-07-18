# Qwen Browser Agent — standalone prototype

This branch is a browser-only comparison for the daemon-based Qwen Code Chrome
extension. Its side panel calls an OpenAI-compatible Alibaba ModelStudio
endpoint, runs the model/tool loop, and controls the active tab without
`qwen serve`, Native Messaging, or an external MCP process.

It is intentionally a browser agent, not the full Qwen Code CLI. It has no
filesystem, shell, Git, repository context, local MCP subprocesses, or Qwen CLI
credential access.

## Build and load

```bash
npm run build
```

Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and
select `dist/extension`.

Open the toolbar action, enter:

- an Alibaba ModelStudio OpenAI-compatible base URL;
- a supported model name;
- a ModelStudio API key.

The default base URL is the Beijing pay-as-you-go endpoint. The allowlist also
contains the standard international and US DashScope endpoints and the China
Token Plan endpoint. The prototype does not accept arbitrary `aliyuncs.com`
subdomains. Use a subscription endpoint only when this interactive browser
agent is permitted by the plan terms.

The API key is stored in `chrome.storage.session` by default. Selecting
**Remember the API key after Chrome exits** moves it to
`chrome.storage.local`, which is persistent but not a hardware-backed secret
store.

## Browser tools

The model can use:

- accessibility snapshot;
- navigation, reload, back, and forward;
- click, fill, form fill, and key press;
- scroll and wait for text.

Actions that change the page always require confirmation. Screenshot,
arbitrary JavaScript, console inspection, network inspection, and page-context
HTTP requests are not exposed to the model in this prototype.

The tools operate through `chrome.debugger`, so Chrome displays its debugger
banner while a tab is attached. Use a disposable profile and test pages while
evaluating the prototype.

## Verify and package

```bash
npm test
npm run typecheck
npm run package
```

The packaged artifact is `chrome-extension.zip`.
