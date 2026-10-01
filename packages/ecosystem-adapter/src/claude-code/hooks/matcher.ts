import type { HookRequest } from "../../hooks/types.js";
import { toClaudeSessionEndReason } from "./session-end-reason.js";

/**
 * Claude matcher rules (docs as of analysis baseline):
 * - omit / "" / "*" → match all
 * - only letters, digits, `_`, `-`, spaces, `,`, `|` → exact tokens split by `|` or `,`
 * - otherwise → unanchored JavaScript RegExp
 * UserPromptSubmit / Stop ignore matchers (always fire).
 * SessionEnd matchers use Claude wire `reason` (mapped from Astravia cause), not host cause ids.
 */
export function matchesClaudeHook(request: HookRequest, matcher: string | undefined): boolean {
	const inputs = matcherInputs(request);
	if (inputs === undefined) return true;
	if (matcher === undefined || matcher.length === 0 || matcher === "*") return true;
	if (isExactMatcher(matcher)) {
		const candidates = splitExactMatcher(matcher);
		return inputs.some((input) => candidates.includes(input));
	}
	try {
		const regex = new RegExp(matcher);
		return inputs.some((input) => regex.test(input));
	} catch {
		return false;
	}
}

export function validateClaudeMatcher(matcher: string): boolean {
	if (matcher.length === 0 || matcher === "*" || isExactMatcher(matcher)) return true;
	try {
		new RegExp(matcher);
		return true;
	} catch {
		return false;
	}
}

export function eventUsesClaudeMatcher(eventName: HookRequest["eventName"]): boolean {
	return eventName !== "UserPromptSubmit" && eventName !== "Stop";
}

function matcherInputs(request: HookRequest): readonly string[] | undefined {
	switch (request.eventName) {
		case "SessionStart":
			return [request.source];
		case "SessionEnd":
			return [toClaudeSessionEndReason(request.cause)];
		case "PreToolUse":
		case "PermissionRequest":
		case "PostToolUse":
		case "PostToolUseFailure":
			return [request.tool.name, ...request.tool.matcherAliases];
		case "PreCompact":
		case "PostCompact":
			return [request.trigger];
		case "SubagentStart":
		case "SubagentStop":
			return [request.agentType];
		case "UserPromptSubmit":
		case "Stop":
			return undefined;
	}
}

function isExactMatcher(matcher: string): boolean {
	return [...matcher].every((character) => /[A-Za-z0-9_\-\s,|]/.test(character));
}

function splitExactMatcher(matcher: string): string[] {
	return matcher
		.split(/[|,]/)
		.map((part) => part.trim())
		.filter((part) => part.length > 0);
}
