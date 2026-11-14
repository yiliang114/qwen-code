# Hosted Harness 自身 Loop 评估（初稿 v1）

[English version](2026-11-15-hosted-harness-loop-evaluation.md)

跟踪 QwenLM/qwen-code#17045 M 块的第二行。交付一项记录在案的决定：
Hosted Harness 自身的 loop（`runHostedHarnessTextTurn`，
`packages/cli/src/serve/hosted-harness-model.ts`）是否迁上
`runAgentLoop`；若不迁，它必须镜像哪些 loop 级行为。本 issue 内不改动
这个 loop 本身。

文档状态：**草稿，证据已收集，决定待评审**。行号基于 `origin/main`
`78d8eb3e2d`。

## 必须回答的四个问题

### 1. Harness 被替换后，在指定轮次恢复一个 Turn

Harness 的 loop 支持从工具结果恢复（`resumeFromToolResults`，
`hosted-harness-model.ts:406`）和恢复模型轮（`resumeModel`，配合使用见
:548、:561）。替换后，新 Harness 在记录的轮次重新进入 loop，并从
已落日志的 transcript 回放。

`runAgentLoop` 目前由每个入口逐轮驱动（`maxRounds: 1`），轮次编号与
恢复点归入口所有。要让 Hosted Harness 迁上来，轮次身份与恢复点必须
能作为 loop 输入表达——这正是 #17045 留给 follow-up 的整轮交接。
**缺口：轮次恢复作为 loop 契约输入。**

### 2. 宿主按次触发的 hook

Harness 通过 `HostedHookSession` 触发 13 种 hook 事件
（`hosted-harness-model.ts:580`，按 occurrence 追踪见 :637），包括
`PostToolBatch`（:86）。恢复的轮次跳过 hook（:835、:880、:960），
保证每次 occurrence 恰好触发一次。

共享 loop 目前不拥有 hook 派发：每个入口自行在 loop 外触发（ACP
`Session.ts`、TUI hooks），1.0 conversation handler 的 hook 派发
（基线 `query-hook-continuation.ts`）在能力账本中归为 `differs`。
**缺口：内核没有按 occurrence 键控的 hook 派发；宿主必须继续在 loop
外按轮次 occurrence 触发，直到 follow-up 把它移进去。**

### 3. 落日志的工具步骤及其恢复

Harness 的工具步骤为每个调用落日志，替换后的 Harness 回放日志中的
调用而不是重新执行（证据见 `packages/core/src/agents/runtime/workflow-sandbox.ts:734` 的 workflow 沙箱日志）。共享 loop 的
`runToolBatch` 把调用状态保存在 `CoreToolScheduler` 内部，没有日志；
1.0 基线的 `tool-executor/state-manager.ts` 与
`tool-call-snapshot.ts`（账本：`missing`）是最接近的模型。
**缺口：loop（或其宿主）重启后可回放的、落日志的工具步骤。**

### 4. 持久输出及其回滚

Harness 把 text delta 写入持久 feed，并在重试时回滚孤立的输出前缀
（`retractDeliveredOutputOnRetry`，`hosted-harness-model.ts:1352`；
`textDeltas?.retract()` 见 :1387、:1403；`TextDeltaSink.retract`
契约见 :159）。

共享 loop 发布 `loop.finished`，但没有持久输出 feed：`loop.output`
已由 #17145 从词汇表移除，输出由各入口自行渲染。
**缺口：作为 loop 级或宿主级契约的、带回滚的持久输出。**

## 初步决定（待评审）

**#17045 内保持 Hosted Harness 用自己的 loop，并记录上述四条镜像
义务。** 迁移需要先补齐全部四个缺口；其中三个（轮次恢复、键控 hook、
落日志的工具步骤）正是本 issue 推迟到 follow-up 的整轮与日志工作。
账本中 `tool-executor` 快照与 `QueryTurn` 的行证明共享 loop 目前还不
是这个 loop 的直接替代品。

具体来说，在该评估被执行前，以下 loop 级行为会被写两遍——共享 loop
一遍、Harness 一遍——任何一侧的改动都必须镜像到另一侧：

| 行为 | 共享 loop | Hosted Harness |
| --- | --- | --- |
| 轮次驱动 / 恢复 | 归入口所有，每次 `runAgentLoop` 调用一轮 | `resumeFromToolResults` / `resumeModel`（`hosted-harness-model.ts:406`） |
| Hook 派发 | 归宿主所有，按入口 | `HostedHookSession`，按 occurrence 键控（:580、:637） |
| 工具批 | 经 `CoreToolScheduler` 的 `runToolBatch` | 落日志的工具步骤，可回放 |
| 输出 | 入口自行渲染；`loop.output` 已移除（#17145） | 带回滚的持久 text-delta feed（:1352–:1403） |

## 考虑过但未采纳的方案

- **现在就把 Harness 迁上 `runAgentLoop`，不做镜像。** 否决：会丢掉
  轮次恢复、键控 hook、工具日志和持久回滚而没有替代品——对 Managed
  Hosted 会话是正确性回归，且没有可回退的开关。
- **在 #17045 内补齐四个缺口。** 否决：按本 issue 自己的分期，每个
  缺口都属于 follow-up 范围（整轮交接、日志、流式/输出词汇），拉进来
  会破坏 11-21 冻结。

## 本行验收

- [x] 四个必答问题已用文件/行号证据回答。
- [ ] 决定在草稿 PR 上评审后定稿。
- [ ] follow-up issue 把这四个缺口列为 Hosted Harness 的条目。
