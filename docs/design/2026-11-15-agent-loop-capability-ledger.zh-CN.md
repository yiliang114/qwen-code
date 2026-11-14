# Agent Loop 能力账本（初稿 v1）

[English version](2026-11-15-agent-loop-capability-ledger.md)

跟踪 QwenLM/qwen-code#17045 的 A 块。基线：tag `v1.0.0-preview`
（`587e3429ca`）；main 对比点 `origin/main`（`78d8eb3e2d`）。状态定义：
`have` —— main 上已存在且行为等价；`differs` —— 存在但有已记录的行为差异；
`missing` —— main 上没有对应实现；`not porting` —— 有意不移植到 main。

## 如何阅读本账本

每一行写出 1.0 Preview 的行为、基线证据（tag 下的 `文件:行号`），以及
main 上的对应实现（main 的 `文件:行号`）或缺口。标注为初稿的行来自
2026-11-15 的目录级 diff 首轮分类，尚待逐行复核。

## 事件总线（`packages/core/src/event-bus/`）

| 能力 | 状态 | 基线 | main | 备注 |
| --- | --- | --- | --- | --- |
| 事件总线原语（发布/订阅、handler 失败隔离） | have | `event-bus/bus.ts` | `event-bus/bus.ts` | 两侧都有 bus；main 版本精简过（147→144 行）且细节有差异——handler 失败语义需逐行核对。 |
| 事件词汇：`loop.started`/`loop.finished`/`loop.cancelled` | differs | `event-bus/events.ts`（`query.submitted`/`query.finished`/`query.cancelled`） | `event-bus/events.ts`（`loop.*`） | 词汇从 query 改名为 loop；`loop.output` 已由 #17145 移除；`llm.tool_use` 改名 `llm.tool_call`（在流式派发落地前不发布）；main 新增 `tool.request`。 |
| 取消作为总线事件 + 有界收尾 | have | `event-bus/state.ts`（`QueryControl`） | `event-bus/state.ts`、`runtime.ts` | 由 #17145 落地：发布并处理 `loop.cancelled`，取消时和调用方停止监听时都有有界收尾。 |
| Conversation handler（轮次驱动、按次触发的 hook） | differs | `event-bus/conversation-handler.ts`、`event-bus/conversation/*`（5 个模块） | `event-bus/conversation.ts`（单模块） | main 把 5 个模块的 conversation handler 合并为一个文件；每种 hook 的行为一致性需要逐行核对。 |
| LLM handler：请求准备、推理轮、结果组装 | differs | `event-bus/llm/*`（5 个模块）、`llm-handler.ts` | `event-bus/llm.ts` | main 包装 `runModelRound`；stop hook、steering、next-speaker、重试、模型 fallback、overflow 恢复按已记录决定留在 `LlmClient`/`LlmChat`（#17045 的 "Not planned"）。 |
| Tool handler（批次派发、settled 发布） | differs | `event-bus/tool-handler.ts` | `event-bus/tool.ts` | main 包装 `runToolBatch`；`tool.cancel` 和 `llm.tool_call` 已声明但在流式派发前不发布（S 块 2026-11-13 的决定）。 |
| 整轮回转的状态机（`QueryState`、运行时状态迁移） | missing | `event-bus/state.ts`（292 行：`QueryRuntimeState`、`ConversationFlow`、continuation 类型）、`core/query-runtime-state.ts` | —— | main 每次 `runAgentLoop` 调用只驱动一轮（`maxRounds: 1`）；整轮交给 loop 明确属于 follow-up issue。 |
| `query.output` / 向消费者流式输出结果 | missing | `event-bus/events.ts`（`query.output`）、`event-bus/query-stream.ts` | —— | 词汇已由 #17145 移除，直到有消费者需要；是否恢复是有意的后续决定，评审后可能落为 `not porting`。 |

## 工具执行器（`packages/core/src/tool-executor/`）

| 能力 | 状态 | 基线 | main | 备注 |
| --- | --- | --- | --- | --- |
| 批量工具执行、逐调用返回结果 | have | `tool-executor/tool-executor.ts`（`ToolExecutor`、`ToolExecutionBatch`） | `core/coreToolScheduler.ts`、`core/agent-loop.ts`（`runToolBatch`） | main 的调度器覆盖批次契约；`runAgentLoop` 已按 #17059 接收批次选项（`keepCancelledResults`、`deferRecording`）。 |
| 流式工具派发（流式期间派发调用） | missing | `tool-executor/streaming/streaming-tool-executor.ts`、`pre-execution-gate.ts`、`tool-execution-wait.ts`、`tool-call-runner.ts` | —— | 在 #16949 评估后于 2026-11-13 决定暂缓：chat-completions 转换器只在流结束时产出调用，收窄后的形态几乎不省时间；与 `llm.tool_call`/`tool.cancel` 发布一起留给 follow-up issue。 |
| 重复调用抑制 | differs | `tool-executor/streaming/repeated-tool-call.ts` | `core/agent-loop.ts`（`defaultDuplicates`、`AgentLoopDuplicateState`） | 两侧都去重；main 的规则挂在共享 loop 上。窗口/阈值语义的等价性待核对。 |
| 权限拒绝文案塑造 | have | `tool-executor/streaming/permission-denial-message.ts` | `core/coreToolScheduler.ts`（`EXECUTION_DENIED` 结算） | main 用类型化错误（`ToolErrorType.EXECUTION_DENIED`）结算被拒绝的调用；文案不同——用户可见措辞有差异，比对文案后定级。 |
| 工具调用快照 / 状态管理器 | missing | `tool-executor/state-manager.ts`、`tool-call-snapshot.ts` | —— | main 把调用状态保存在 `CoreToolScheduler` 内部，没有快照日志。整轮恢复需要它；候选与流式派发一起进入 follow-up。 |

## core 的 `query-*` 模块（`packages/core/src/core/query-*`）

| 能力 | 状态 | 基线 | main | 备注 |
| --- | --- | --- | --- | --- |
| Query 轮次驱动器（`QueryTurn`——多轮的 turn 循环） | missing | `core/query-turn.ts` | `core/agent-loop.ts`（各入口 `maxRounds: 1` 的 `runAgentLoop`） | 这正是本 issue 要补的核心缺口；整轮交接属于 follow-up 范围，各入口按阶梯迁移。 |
| 恢复：畸形 tool-use、max-output-tokens、prompt-too-long、reactive compact | missing | `core/query-recovery.ts`（`build*RecoveryState`、升级策略） | `core/client.ts` / `LlmClient` 的重试与 overflow 路径 | main 在 chat 层内有重试/overflow 恢复；形态和可见性不同。钉住 main 的行号证据后可能归为 `differs`；是否移植属于 "Not planned" 的 continuation/recovery 决策。 |
| 结果收集（`collectQueryResults`） | missing | `core/query-result-collector.ts` | 各入口各自的结果收集 | main 每个入口在自己的轮次驱动里组装结果；随整轮迁移统一。 |
| Hook 续接（`resolveHookAfterResult`） | differs | `core/query-hook-continuation.ts` | 各入口的 hook 派发（如 ACP `Session.ts`、TUI hooks） | main 由宿主触发 hook，而不是 conversation handler；按次触发的 hook 次序属于 Hosted Harness 评估（M 块）的一部分。 |
| 终止分类（`classifyTaskTerminal`、`PostCompactContextLimitError`） | missing | `core/query-terminal.ts` | 部分：各入口临时分类 stop reason | `PostCompactContextLimitError` 在 main 没有对应物；main 依赖 chat 层的 reactive compression。 |
| 请求消息构造 / 业务上下文 / 参数 | differs | `core/query-request-messages.ts`、`query-business-context.ts`、`query-params.ts`（`DEFAULT_MAX_TURNS`） | `core/client.ts` 的请求组装 | 等价输入在 main 以不同模块边界存在；预期无行为差异——文档阶段核对。 |
| Loop 诊断（`makeLoopId`、`log*Turn/Loop/Tool*`） | differs | `core/query-diagnostics.ts` | `utils/debugLogger` 调用点、`loop.*` 事件 | main 的信号是 debug 标记 + `/about` 的 loop 行（B 块未完成的行），而不是诊断模块。 |

## 待评审的开放问题

1. `query.output`/`query-stream`：记为 `not porting`（词汇已由 #17145 移除）还是在有消费者前记为 `missing`？
2. 恢复模块："Not planned" 已记录把恢复留在 `LlmClient` 的决定；账本这些行是标 `not porting` 并引用该决定，还是标 `differs` 并补 main 行号证据？
3. 工具调用快照日志：只有在入口把整轮交给 loop 后才需要——确认归入 follow-up issue。

## 每周 diff 记录

- 2026-11-15：对照 `v1.0.0-preview` 首轮 diff `event-bus/`、`tool-executor/`、`core/query-*`。有漂移的同名文件：`bus.ts`、`bus.test.ts`、`events.ts`、`handler-support.ts`、`runtime.ts`、`state.ts`（都在 event-bus）。仅 main 有：`adapter.ts`、`conversation.ts`、`llm.ts`、`tool.ts`、`loop.test.ts`、`state.test.ts`。仅基线有（main 上不存在）：`tool-executor/` 全部 16 个文件、`core/query-*` 全部 11 个文件、`event-bus/conversation-handler.ts`、`event-bus/llm-handler.ts`、`event-bus/tool-handler.ts`、`event-bus/query-stream.ts`、`event-bus/conversation/*`（5 个）、`event-bus/llm/*`（5 个）。
