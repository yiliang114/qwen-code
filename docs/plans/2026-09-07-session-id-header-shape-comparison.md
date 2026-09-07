# Where should a per-conversation session header be configured?

Two shapes for the same user need (#10995): a gateway that requires a stable
per-conversation identifier, e.g. OpenCode Go rejecting requests without
`x-opencode-session`.

- **Shape A** — `outboundCorrelation.sessionIdHeader: { enabled, headerName, trustedHosts }`, a
  new global setting with its own host allowlist. This is what PR #11282 implements.
- **Shape B** — a `${session_id}` placeholder in the existing per-provider
  `modelProviders[].generationConfig.customHeaders`, plus one global consent
  switch. This branch implements it, for comparison.

Nothing here argues against the feature. Both shapes ship it. The question is
only where the configuration lives.

## The deciding argument: Shape A cannot express two gateways

`sessionIdHeader.headerName` is a single global string, and `trustedHosts` is a
list of hosts that all receive **that one** header name. So:

| Scenario                                                          | Shape A                                   | Shape B                             |
| ----------------------------------------------------------------- | ----------------------------------------- | ----------------------------------- |
| Provider X needs `x-opencode-session`                             | ✅                                        | ✅                                  |
| …and provider Y needs `x-session-id` at the same time             | ❌ **inexpressible**                      | ✅                                  |
| Provider Z must not send it                                       | via `trustedHosts` omission               | automatic — no header on that entry |
| Two model entries on the _same host_, only one behind the gateway | ❌ host allowlist cannot distinguish them | ✅ per-entry                        |

The second row is the one that matters. It is not a style preference: a user
with two gateways has to pick one header name and let the other provider receive
the wrong one.

## `trustedHosts` re-encodes information the config already has

You write the endpoint once in `modelProviders[].baseUrl`. Shape A asks you to
write the same host again in `trustedHosts`, and then compares the two copies you
wrote. That duplication exists only because the setting is global: a global
setting has no scope of its own, so it has to build one, and the only material
available is the `baseUrl` you already supplied.

The one advantage of a global setting — "configure it once instead of per
provider" — is exactly the case where the session ID reaches hosts you did not
think about, which is what the allowlist then exists to prevent. It creates the
problem it spends most of its code solving. In this branch, roughly 90 lines of
host normalization, punycode conversion, wildcard/scheme/port rejection and
allowlist validation are simply absent, because the scoping is inherited.

## What Shape B keeps from the reviewer's objection

LaZzyMan's round-8 objection to PR #4390 — recorded in
`docs/design/telemetry-outbound-propagation-design.md` §12.1 — was that
`telemetry.*` implies "recipient is your own OTLP collector", while these headers
go to a third-party LLM provider, and the two deserve different consent decisions.
That argument is correct and Shape B keeps it: `outboundCorrelation.allowDynamicHeaderValues`
is a consent switch under the same namespace, default off.

What Shape B does _not_ put in the global namespace is scoping and naming, which
the provider entry already answers.

The switch earns its place for a second reason: `customHeaders` can arrive from a
provider preset (`packages/core/src/providers/presets/*.ts` ship them) or an
extension, and provenance is lost once presets and user settings are merged. The
gate is what separates "I typed this" from "something shipped this", so a preset
cannot silently promote a static header into an identity header.

## Provenance: the rejection on record answers a different argument

§12.2 of the same design doc says:

> 经过几轮内部讨论（含 yiliang 提出的 customHeader 模板替代方案，最终判定 customHeader 不能携带 runtime-dynamic 值），决定走 **方案 C**

Checking that against the record:

- The proposal is real: PR #4390, 2026-05-22T10:59
  (https://github.com/QwenLM/qwen-code/pull/4390#issuecomment-4518059628).
- **It was not a "template" proposal.** The word does not appear in it. The
  argument made was that `customHeaders` is _per-provider_ — "without leaking
  identifiers indiscriminately to all third-party providers" — at "zero
  additional complexity".
- The recorded rejection ("cannot carry runtime-dynamic values") answers the
  template framing, not the scoping argument. It is also a statement about the
  code as it stands rather than a design constraint: `buildHeaders()` runs once
  inside `buildClient()`, but the per-request hook already exists in
  `wrapFetchWithSessionId`, which sets headers _after_ the SDK's.
- Across every issue comment and review comment on #4390, the string
  `customHeader` appears exactly once — in that comment. **No reply to it exists
  in the public record.** The design doc was added three days later, in the same
  PR, by a different author.

So the chain #11282 → §12.7 → §12.2 rests at its root on a conclusion that was
never publicly answered, about an argument that was never publicly addressed.
That is worth reopening before more is built on Shape A, not because anyone acted
in bad faith, but because the scoping point is the one that turns out to decide
the design.

## What this branch changes

| File                                                                                     | Change                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/src/core/outbound-dynamic-headers.ts`                                              | New. Placeholder set, per-value expansion, fail-closed drops, `Headers` rewrite, per-request subset for Gemini.                                                                                                                                                |
| `core/src/core/outbound-session-id.ts`                                                   | Fetch wrapper expands placeholders before writing the built-in header, preserving `correlation > customHeaders` precedence. Whether any placeholder exists is decided once at client construction, so providers without one cost exactly what they cost today. |
| `openaiContentGenerator/provider/{default,dashscope}.ts`, `anthropicContentGenerator.ts` | Pass the provider's `customHeaders` to the wrapper.                                                                                                                                                                                                            |
| `llm-content-generator.ts`                                                               | Re-emit the placeholder-bearing subset per request, overriding the client-level copy the SDK froze at construction.                                                                                                                                            |
| `config/config.ts`, `cli/src/config/settingsSchema.ts`                                   | `outboundCorrelation.allowDynamicHeaderValues`, default false.                                                                                                                                                                                                 |
| docs                                                                                     | `model-providers.md` (where the header goes), `settings.md` (the consent switch).                                                                                                                                                                              |

Not implemented here, deliberately: removing Shape A. If Shape B is chosen,
#11282's opt-in branch comes out and its built-in first-party allowlist stays
untouched.

## Verification status

Everything below is **unverified** — this sandbox cannot build or run the suite,
and the box is memory-constrained.

- ESLint passes on every changed file.
- `outbound-dynamic-headers.test.ts` (18 cases) has **not been executed**: the
  vitest global setup requires `npm run build` first, which was not run.
- `npm run generate:settings-schema` could not run for the same reason (it loads
  the built core through `dist/`). The `settings.schema.json` entry was added by
  hand, with the description string extracted programmatically from
  `settingsSchema.ts` so the two cannot disagree. **CI's schema-drift check is
  the authority** — if it reports a diff, re-run the generator and commit.

To verify on a build-capable machine:

```bash
npm run build
npm run test --workspace=@qwen-code/qwen-code-core -- src/core/outbound-dynamic-headers.test.ts
npm run test --workspace=@qwen-code/qwen-code-core -- src/core/outbound-session-id.test.ts
npm run generate:settings-schema && git diff --exit-code packages/vscode-ide-companion/schemas/settings.schema.json
npm run typecheck && npm run lint
```
