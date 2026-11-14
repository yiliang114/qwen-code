# ACP live 工具与 Agent Host 会话迁到共享工具批

[English](./2026-11-14-acp-live-agent-host-shared-batch.md)

## 背景

本项是 #17045 中 ACP 的一行 (`packages/cli/src/acp-integration/session/`)：
带 live 工具的会话和只读的 Agent Host 会话迁到共享工具批，并删除
`toolLoopGuardsByHost`。改动前 `#runsToolsOnSharedBatch()` (`Session.ts`)
对注册过 live 工具、以及 `getSessionSourceType()` 为 `agent-host` 的会话
返回 `false`，它们的轮次走 ACP 自己的工具步骤，并向 core 传
`toolLoopGuardsByHost: true` 让 core 的 loop guards、todo reminder 和
结果感知去重交给宿主侧。

这一行接着 #17070（`interactionSpanByHost`、`userTurnRecordedByHost` 成为
输入），在 #17181（ACP 第 3 步）之上展开；默认开关不变。

## 基线

对照 #17181 头 `447a0abe26`，接入点在 #17181 之后形状收敛：

- 共享 loop 的轮次用 `startSharedLoopRound` 启动，返回
  `{ model, runBatch, close }`。模型请求和工具批都在同一次
  `runAgentLoop` 里；批（含 replay）由 `runBatch` 交接后才推进，它运行
  在 `runBatch` 的 async 上下文中；turn 提前离开时关闭 round 的 loop。
- ACP 以 `deferRecording: false`、保留 cancelled 结果，用
  `createSchedulerExecutor` 走批；`runAcpToolBatch` 接受 round 的
  loop（`loop.runBatch`），stale plan 检查经 `beforeToolLaunch`；
  `Session.ts` 的 `#runSharedToolBatch` 通过 `SharedRound.onLoop` 接收
  `SharedLoopRound`。
- 本设计不改动交接机制本身：审批仍走 `session/request_permission`，更新
  仍走 ACP `tool_call`，内核 / event-bus 那档问题归 #17181。

## 方案

### live 工具的信任

`AcpToolBatchHost` 的 `isTrustedLiveTool` 输入（转发至
`CoreToolSchedulerOptions.isTrustedTool`）按实例身份（而非工具名）识别会话的
三个可信 live 工具实例。在 `CoreToolScheduler` 内，受信任的工具实例直接跳过
L1 `PermissionManager.isToolEnabled` / 旧版拒绝列表检查以及 L3→L4
`evaluatePermissionFlow` 权限评估，无需交互式审批
即可直接调度执行。它们的执行通道是会话的 daemon `extMethod`，已由
`setLiveConversationActive` 生命周期约束，因此模型调用它们时不会产生审批请求。
信任按工具实例引用相等判定，同一 live 会话中的普通工具或同名 MCP 工具仍走正常
ACP 权限流程。

### Agent Host 的只读行为

工作区路径围栏与只读工具策略仍由会话 `Config` 提供：其
`getToolInvocationGuard()`（`createAgentHostToolInvocationGuard`）由
`CoreToolScheduler` 在执行边界评估，违反工作区围栏或只读策略的调用以
`EXECUTION_DENIED`（`not_started`）及围栏拒绝原因结算。批不再另建或转发第二份
围栏。

`readOnlyRefusalMessage` 是唯一经 `AcpToolBatchHost` 转发给
`CoreToolSchedulerOptions` 的宿主行为，仅在调用真正到达交互式审批关口时
（`awaiting_approval` 之前、自动放行的只读检查与权限 hook 之后）触发。工作区内
自动放行的只读工具（`read_file`、`ls`、`grep`、`glob`）正常执行；任何仍需交互
审批的调用以 `EXECUTION_DENIED`（`not_started`）和消息
`Tool "<name>" requires approval, which is unavailable on this read-only Agent Host.`
拒绝，不发送 `session/request_permission`，也不中止整轮对话。

### 去掉 flag

两类会话迁到共享批之后，`#runsToolsOnSharedBatch()` 直接删除（两个调用点并入
共享路径）。`toolLoopGuardsByHost` 从 `SendMessageOptions` 删除，core 的
loop guards、todo reminder 和结果感知去重对每个 ACP 轮次生效。
`checkAlwaysOnSafeties`（整轮次数上限、连续相同调用守卫——含后台任务豁免）接管
该轮；TUI 依赖的重复停止（#14590，含 YOLO 后台任务）在统一 loop 下由批的
`keepCancelledResults: true` 保持对等的覆盖形态。

### 测试计划

测试按价值驱动，在现有测试套件中补齐真实共享批的集成场景：

- `Session.test.ts` 翻转原先断言 `toolLoopGuardsByHost: true` 的用例，并在
  `kernel=false` 与 `kernel=true` 下通过真实 `runAcpToolBatch` 与
  `CoreToolScheduler` 运行两类集成场景：
  1. live 工具会话在同一共享批中同时调用可信的 `capture_screen_context` 与需审批的
     普通 `read_file` 工具，验证可信 live 工具跳过 `isToolEnabled` 与
     `requestPermission` 直接执行，而同一会话中的普通工具仍发出 ACP 权限请求。
  2. 只读 Agent Host 会话在 `ApprovalMode.DEFAULT` 下运行工作区内自动放行的
     `list_directory`、由会话 Config 的 `getToolInvocationGuard()` 拦截工作区外的
     `read_file`，以及由
     `readOnlyRefusalMessage` 拒绝工作区内需审批的 `read_file`（零次
     `requestPermission` 调用），并继续推进到下一模型轮。
- `acp-tool-batch.test.ts` 验证 `runAcpToolBatch` 将 `isTrustedLiveTool` 与
  `readOnlyRefusalMessage` 转发给 `createSchedulerExecutor`。

## 风险与边界

- **重复停止回归（#14590）。** TUI 的后台任务重复停止现由
  `checkAlwaysOnSafeties` 提供。统一 loop 下，executor 返回打捞结果，
  cancelled 批的缺失响应合成为 cancellation。`keepCancelledResults: true`
  的形态与该停止等价。
- **live 任务轮询。** always-on 连续相同调用守卫不区分结果是否改变
  （#9450 的豁免在 core 的结果感知去重里）。若出现真实回归，把 live
  任务工具的 sentinel 按实例身份写进批的重复处理，而不是扩 core 豁免：
  信任按实例身份判定，同名工具不继承。
- **Agent Host 的 glob/grep。** 会话 `Config.getToolInvocationGuard()` 由
  `CoreToolScheduler` 在执行边界应用，因此 `read_file`、`glob`、`grep`、`ls` 的
  工作区外路径在执行前被拦截。
- **#17181 依赖。** 分支基于 #17181 的 `SharedLoopRound` 交接形状，并与 `main`
  合流。

## 验收

- `#runsToolsOnSharedBatch()` 删除；`toolLoopGuardsByHost` 从
  `SendMessageOptions` 及其读点消失。
- live 会话与 Agent Host 会话都走共享批，并由共享批集成场景覆盖可信 live 工具
  免审执行、普通工具权限审批、Agent Host 自动放行只读工具、工作区外
  `getToolInvocationGuard()` 拦截，以及需审批调用的只读拒绝（零次外发
  `requestPermission`）。
