# Tool timing is a separate SessionEntry, not a field on ToolResultMessage

Tool call timing (start time, duration, internal phase breakdown) is persisted as a new `tool_timing` entry in the session jsonl, parallel to `message` / `thinking_level_change` / `model_change` — **not** as new fields on `ToolResultMessage` and **not** under `ToolResultMessage.details`.

The driving requirement is: timing must never be sent to the LLM as context. Provider code only converts `message`-type entries into the API payload, so storing timing in a non-message channel makes the boundary architectural rather than something that has to be re-enforced in every provider's `convertMessages`. Future timing fields can be added without touching `@astravia/ai`.

## Considered options

- **Fields on `ToolResultMessage`** (`startedAt`, `durationMs`, `phases`). Most natural mapping but requires a whitelist/blacklist filter in every provider's serializer; the moment one provider forgets, timing leaks into the prompt and silently inflates input tokens / pollutes reasoning.
- **`ToolResultMessage.details`**. `details` is already `any` and currently isn't sent to most providers, but the boundary is implicit rather than enforced by the type system — a future provider author could read `details` "to give the model more context" and break the invariant.
- **Separate `tool_timing` SessionEntry** (chosen). LLM providers don't look at non-message entries; the boundary is positive (allow-list of what enters the prompt), not negative (block-list of fields to strip).

## Consequences

- Loading historical sessions requires a join on `toolCallId` to attach timing to its tool_call block in the UI. O(N) Map lookup, no real cost.
- Sessions written before this entry type existed will simply have no timing data. UI shows nothing — by design, no estimated/synthesized values.
- Tools running when the process crashes lose their timing (the entry is only written at `tool_execution_end`). Acceptable because the `ToolResultMessage` itself is also missing in that case — the conversation is already in an inconsistent state.
