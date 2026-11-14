# Agent-Loop Capability Ledger (Draft v1)

[中文版本](2026-11-15-agent-loop-capability-ledger.zh-CN.md)

Tracks QwenLM/qwen-code#17045, block A. Baseline: tag `v1.0.0-preview`
(`587e3429ca`); main compared at `origin/main` (`78d8eb3e2d`). Statuses:
`have` — the capability exists on main with equivalent behavior;
`differs` — exists with a recorded behavioral difference; `missing` — no
counterpart on main; `not porting` — intentionally not carried to main.

## How to read this ledger

Every row names the 1.0 Preview behavior, its baseline evidence
(`file:line` under the tag), and main's counterpart (`file:line` on main)
or the gap. Rows marked provisional are first-pass classifications from the
2026-11-15 directory diff and are pending row-by-row verification.

## Event bus (`packages/core/src/event-bus/`)

| Capability | Status | Baseline | Main | Notes |
| --- | --- | --- | --- | --- |
| Event bus primitive (publish/subscribe, handler failure isolation) | have | `event-bus/bus.ts` | `event-bus/bus.ts` | Both trees carry the bus; main's version is trimmed (147→144 lines) and differs in detail — verify handler-failure semantics row by row. |
| Event vocabulary: `loop.started`/`loop.finished`/`loop.cancelled` | differs | `event-bus/events.ts` (`query.submitted`/`query.finished`/`query.cancelled`) | `event-bus/events.ts` (`loop.*`) | Vocabulary renamed query→loop; `loop.output` removed (#17145); `llm.tool_use` renamed `llm.tool_call` (unpublished until streaming dispatch); `tool.request` added on main. |
| Cancellation as a bus event with bounded close | have | `event-bus/state.ts` (`QueryControl`) | `event-bus/state.ts`, `runtime.ts` | Landed by #17145: `loop.cancelled` published and handled, bounded close on cancellation and when the caller stops listening. |
| Conversation handler (turn driving, per-occurrence hooks) | differs | `event-bus/conversation-handler.ts`, `event-bus/conversation/*` (5 modules) | `event-bus/conversation.ts` (single module) | Main collapsed the 5-module conversation handler into one file; behavior parity per hook kind needs row-level verification. |
| LLM handler: request preparation, inference round, result assembly | differs | `event-bus/llm/*` (5 modules), `llm-handler.ts` | `event-bus/llm.ts` | Main wraps `runModelRound`; stop-hook/steering/next-speaker/retry/fallback/overflow stay in `LlmClient`/`LlmChat` by recorded decision ("Not planned" in #17045). |
| Tool handler (batch dispatch, settled publication) | differs | `event-bus/tool-handler.ts` | `event-bus/tool.ts` | Main wraps `runToolBatch`; `tool.cancel` and `llm.tool_call` declared but never published until streaming dispatch (block S decision, 2026-11-13). |
| Full-turn state machine (`QueryState`, runtime-state transitions) | missing | `event-bus/state.ts` (292 lines: `QueryRuntimeState`, `ConversationFlow`, continuation types), `core/query-runtime-state.ts` | — | Main drives one round per `runAgentLoop` call (`maxRounds: 1`); whole-turn ownership is explicitly follow-up-issue scope. |
| `query.output` / result streaming to consumers | missing | `event-bus/events.ts` (`query.output`), `event-bus/query-stream.ts` | — | Removed from the vocabulary by #17145 until a consumer needs it; re-adding is a deliberate future decision, so this may land as `not porting` after review. |

## Tool executor (`packages/core/src/tool-executor/`)

| Capability | Status | Baseline | Main | Notes |
| --- | --- | --- | --- | --- |
| Batch tool execution with per-call results | have | `tool-executor/tool-executor.ts` (`ToolExecutor`, `ToolExecutionBatch`) | `core/coreToolScheduler.ts`, `core/agent-loop.ts` (`runToolBatch`) | Main's scheduler covers the batch contract; `runAgentLoop` now accepts batch options (`keepCancelledResults`, `deferRecording`) per #17059. |
| Streaming tool dispatch (calls dispatched mid-stream) | missing | `tool-executor/streaming/streaming-tool-executor.ts`, `pre-execution-gate.ts`, `tool-execution-wait.ts`, `tool-call-runner.ts` | — | Evaluated in #16949 and deferred 2026-11-13: chat-completions converters emit calls only at stream end, so the narrowed form saves almost no time; kept for the follow-up issue with `llm.tool_call`/`tool.cancel` publishers. |
| Repeat-call suppression | differs | `tool-executor/streaming/repeated-tool-call.ts` | `core/agent-loop.ts` (`defaultDuplicates`, `AgentLoopDuplicateState`) | Both trees dedupe; main's rule lives on the shared loop. Verify equivalence of window/threshold semantics. |
| Permission denial message shaping | have | `tool-executor/streaming/permission-denial-message.ts` | `core/coreToolScheduler.ts` (`EXECUTION_DENIED` settlements) | Main settles denied calls with typed errors (`ToolErrorType.EXECUTION_DENIED`); message text differs — user-visible wording differs, classify after comparing copy. |
| Tool-call snapshots / state manager | missing | `tool-executor/state-manager.ts`, `tool-call-snapshot.ts` | — | Main keeps call state inside `CoreToolScheduler`; no snapshot journal. Needed for whole-turn recovery; candidate for follow-up with streaming dispatch. |

## Core `query-*` modules (`packages/core/src/core/query-*`)

| Capability | Status | Baseline | Main | Notes |
| --- | --- | --- | --- | --- |
| Query turn driver (`QueryTurn` — multi-round turn loop) | missing | `core/query-turn.ts` | `core/agent-loop.ts` (`runAgentLoop` with `maxRounds: 1` per surface) | The core gap this issue exists to close; whole-turn hand-off is follow-up scope, surfaces move per the ladder. |
| Recovery: malformed tool-use, max-output-tokens, prompt-too-long, reactive compact | missing | `core/query-recovery.ts` (`build*RecoveryState`, escalation) | `core/client.ts` / `LlmClient` retry & overflow paths | Main has retry/overflow recovery inside the chat layer; behavior differs in shape and visibility. Candidate `differs` row once main's exact line evidence is pinned; decision on porting belongs to the "Not planned" continuation/recovery discussion. |
| Result collection (`collectQueryResults`) | missing | `core/query-result-collector.ts` | surface-specific collectors | Each main surface assembles results in its own turn driver; unified with the whole-turn move. |
| Hook continuation (`resolveHookAfterResult`) | differs | `core/query-hook-continuation.ts` | per-surface hook dispatch (e.g. ACP `Session.ts`, TUI hooks) | Main fires hooks from hosts, not the conversation handler; keyed-by-occurrence hook ordering is part of the Hosted Harness evaluation (block M). |
| Terminal classification (`classifyTaskTerminal`, `PostCompactContextLimitError`) | missing | `core/query-terminal.ts` | partial: surfaces classify stop reasons ad hoc | `PostCompactContextLimitError` has no main counterpart; main relies on reactive compression in the chat layer. |
| Request message construction / business context / params | differs | `core/query-request-messages.ts`, `query-business-context.ts`, `query-params.ts` (`DEFAULT_MAX_TURNS`) | `core/client.ts` request assembly | Equivalent inputs exist on main in different module boundaries; no behavior gap expected — verify during doc pass. |
| Loop diagnostics (`makeLoopId`, `log*Turn/Loop/Tool*`) | differs | `core/query-diagnostics.ts` | `utils/debugLogger` call sites, `loop.*` events | Main's signal is the debug marker + `/about` loop line (block B row, open) rather than a diagnostics module. |

## Open questions for review

1. `query.output`/`query-stream`: record as `not porting` (vocabulary removed by #17145) or `missing` pending a consumer?
2. Recovery module: the "Not planned" note records a decision to keep recovery in `LlmClient`; should the ledger mark these rows `not porting` with that citation, or `differs` with main line evidence?
3. Tool-call snapshot journal: only needed once a surface hands the whole turn to the loop — confirm it belongs to the follow-up issue.

## Weekly diff log

- 2026-11-15: initial diff of `event-bus/`, `tool-executor/`, `core/query-*` against `v1.0.0-preview`. Shared files with drift: `bus.ts`, `bus.test.ts`, `events.ts`, `handler-support.ts`, `runtime.ts`, `state.ts` (all event-bus). Main-only: `adapter.ts`, `conversation.ts`, `llm.ts`, `tool.ts`, `loop.test.ts`, `state.test.ts`. Baseline-only (not on main): all of `tool-executor/` (16 files), all of `core/query-*` (11 files), `event-bus/conversation-handler.ts`, `event-bus/llm-handler.ts`, `event-bus/tool-handler.ts`, `event-bus/query-stream.ts`, `event-bus/conversation/*` (5), `event-bus/llm/*` (5).
