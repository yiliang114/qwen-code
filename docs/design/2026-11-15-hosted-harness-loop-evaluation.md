# Hosted Harness Loop Evaluation (Draft v1)

[中文版本](2026-11-15-hosted-harness-loop-evaluation.zh-CN.md)

Tracks QwenLM/qwen-code#17045, block M, second row. Delivers a recorded
decision: whether the Hosted Harness's own loop
(`runHostedHarnessTextTurn`, `packages/cli/src/serve/hosted-harness-model.ts`)
moves onto `runAgentLoop`, or which loop-level behaviors it then has to
mirror. The loop itself does not change in #17045.

Status of this document: **draft, evidence gathered, decision pending
review**. Line references are against `origin/main` `78d8eb3e2d`.

## The four required questions

### 1. Resuming a turn at a given round after the Harness is replaced

The Harness loop supports resuming from tool results
(`resumeFromToolResults`, `hosted-harness-model.ts:406`) and resuming a
model turn (`resumeModel`, used together at :548, :561). On replacement,
the new Harness re-enters the loop at the recorded round and replays from
the journaled transcript.

`runAgentLoop` today is driven one round at a time by each surface
(`maxRounds: 1`), and the surfaces own round numbering and resumption.
For the Hosted Harness to move, round identity and resume points must be
expressible as loop inputs — the whole-turn hand-off that #17045 leaves
to the follow-up issue. **Gap: round-resume as a loop contract input.**

### 2. Hooks the host fires, keyed by occurrence

The Harness fires 13 hook event kinds through `HostedHookSession`
(`hosted-harness-model.ts:580`, occurrence tracking via
`hasCompletedOccurrence` at :637), including `PostToolBatch`
(:86). Hooks are skipped on resumed rounds (:835, :880, :960) so each
occurrence fires exactly once.

The shared loop does not own hook dispatch today: each surface fires its
own hooks (ACP `Session.ts`, TUI hooks) outside the loop, and the 1.0
conversation handler's hook dispatch (`query-hook-continuation.ts` on the
baseline) is classified `differs` in the capability ledger. **Gap: the
kernel has no keyed hook dispatch; hosts must keep firing hooks, keyed by
round occurrence, outside the loop until the follow-up moves them in.**

### 3. The journaled tool step and its recovery

The Harness's tool step journals every call so a replacement Harness
replays journaled calls instead of re-executing them (see the workflow
sandbox journal evidence in `packages/core/src/agents/runtime/workflow-sandbox.ts:734`).
The shared loop's `runToolBatch` keeps call state inside
`CoreToolScheduler` and has no journal; the 1.0 baseline's
`tool-executor/state-manager.ts` and `tool-call-snapshot.ts` (ledger:
`missing`) are the closest model. **Gap: a journaled tool step that the
loop (or its host) can replay on restart.**

### 4. Durable output and its retraction

The Harness writes text deltas to a durable feed and retracts orphaned
prefixes on retry (`retractDeliveredOutputOnRetry`,
`hosted-harness-model.ts:1352`; `textDeltas?.retract()` at :1387, :1403;
the `TextDeltaSink.retract` contract at :159).

The shared loop publishes `loop.finished` but has no durable output feed:
`loop.output` was removed from the vocabulary by #17145, and surfaces
render their own output. **Gap: durable output with retraction as a
loop-level or host-level contract.**

## Preliminary decision (pending review)

**Keep the Hosted Harness on its own loop in #17045, and record the four
mirror obligations above.** Moving it needs all four gaps closed; three of
them (round resume, keyed hooks, journaled tool step) are exactly the
whole-turn and journal work the issue defers to the follow-up. The ledger
rows for `tool-executor` snapshots and `QueryTurn` are the evidence that
the shared loop is not yet a drop-in for this loop.

Concretely, until the evaluation is acted on, the following loop-level
behaviors are written twice — once in the shared loop and once in the
Harness — and changes to either must be mirrored in the other:

| Behavior | Shared loop | Hosted Harness |
| --- | --- | --- |
| Round driving / resumption | surface-owned, one round per `runAgentLoop` call | `resumeFromToolResults` / `resumeModel` (`hosted-harness-model.ts:406`) |
| Hook dispatch | host-owned, per surface | `HostedHookSession` with occurrence keys (`:580`, `:637`) |
| Tool batch | `runToolBatch` via `CoreToolScheduler` | journaled tool step with replay |
| Output | surface-rendered; `loop.output` removed (#17145) | durable text-delta feed with retraction (`:1352`–`:1403`) |

## Alternatives considered

- **Move the Harness onto `runAgentLoop` now, mirroring nothing.**
  Rejected: it would drop round resume, keyed hooks, the tool journal,
  and durable retraction with no replacement — a correctness regression
  for Managed Hosted sessions, which cannot run a switch-back.
- **Close the four gaps inside #17045.** Rejected: each gap is follow-up
  scope by the issue's own staging (whole-turn hand-off, journal,
  streaming/output vocabulary), and pulling them in breaks the 11-21
  freeze.

## Acceptance for this row

- [x] The four required questions answered with file/line evidence.
- [ ] Decision reviewed on the draft PR and finalized.
- [ ] The follow-up issue carries the four gaps as its Hosted Harness rows.
