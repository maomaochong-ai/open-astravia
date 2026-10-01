import type { SessionEndCause } from "../../hooks/types.js";

/**
 * Claude Code SessionEnd stdin / settings matcher `reason` values.
 * Only used inside the Claude profile — never as Astravia host API.
 *
 * @see https://docs.anthropic.com/en/docs/claude-code/hooks
 */
export type ClaudeSessionEndReason =
	| "clear"
	| "resume"
	| "logout"
	| "prompt_input_exit"
	| "bypass_permissions_disabled"
	| "other";

/**
 * Map Astravia session-end cause → Claude wire `reason` for stdin + matcher.
 *
 * | Astravia cause       | Claude reason | Rationale |
 * |-------------------|---------------|-----------|
 * | new_session       | clear         | Leave current transcript for a blank session |
 * | fork_session      | clear         | Old session is abandoned for a new branch id |
 * | switch_session    | resume        | Leave current session to open another file |
 * | dispose           | other         | Host teardown without Claude-specific UI reason |
 */
export function toClaudeSessionEndReason(cause: SessionEndCause): ClaudeSessionEndReason {
	switch (cause) {
		case "new_session":
		case "fork_session":
			return "clear";
		case "switch_session":
			return "resume";
		case "dispose":
			return "other";
	}
}
