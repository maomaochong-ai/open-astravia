import type { HookDispatchEffect } from "@vetta/coding-agent/hooks";
import type { PluginCodingAgentHookEventName } from "@vetta-org/plugin-sdk";

export function parseDesktopPluginHookResult(
	eventName: PluginCodingAgentHookEventName,
	value: unknown,
): HookDispatchEffect {
	if (value === undefined || value === null) return emptyEffect();
	if (!isRecord(value)) throw new Error("Plugin Hook result must be an object");

	const action = value.action;
	if (action !== "continue" && action !== "block" && action !== "stop" && action !== "continue-agent") {
		throw new Error("Plugin Hook result action is invalid");
	}
	if (action === "continue-agent" && eventName !== "Stop" && eventName !== "SubagentStop") {
		throw new Error(`Plugin Hook ${eventName} cannot continue the agent`);
	}
	assertAllowedKeys(value, allowedResultKeys(action, eventName));

	const reason = optionalString(value.reason, "reason");
	if (action === "block" && !reason) throw new Error("Plugin Hook block result requires a reason");
	const additionalContexts = optionalStringArray(value.additionalContexts, "additionalContexts");
	const continuationFragments = optionalStringArray(value.continuationFragments, "continuationFragments");
	if (action === "continue-agent" && continuationFragments.length === 0) {
		throw new Error("Plugin Hook continue-agent result requires continuationFragments");
	}

	const updatedToolInput = value.updatedToolInput;
	if (updatedToolInput !== undefined) {
		if (eventName !== "PreToolUse") throw new Error(`Plugin Hook ${eventName} cannot update tool input`);
		if (!isRecord(updatedToolInput)) throw new Error("Plugin Hook updatedToolInput must be an object");
	}

	const permissionDecision = value.permissionDecision;
	if (permissionDecision !== undefined) {
		if (eventName !== "PermissionRequest") {
			throw new Error(`Plugin Hook ${eventName} cannot return a permission decision`);
		}
		if (permissionDecision !== "allow" && permissionDecision !== "deny") {
			throw new Error("Plugin Hook permissionDecision is invalid");
		}
	}

	return {
		shouldStop: action === "stop",
		stopReason: action === "stop" ? reason : undefined,
		shouldBlock: action === "block" || action === "continue-agent",
		blockReason: action === "block" ? reason : undefined,
		additionalContexts,
		feedbackMessage: optionalString(value.feedbackMessage, "feedbackMessage"),
		continuationFragments: action === "continue-agent" ? continuationFragments : [],
		updatedToolInput,
		permissionDecision,
		permissionMessage: optionalString(value.permissionMessage, "permissionMessage"),
	};
}

function allowedResultKeys(
	action: "continue" | "block" | "stop" | "continue-agent",
	eventName: PluginCodingAgentHookEventName,
): ReadonlySet<string> {
	if (action === "block" || action === "stop") return new Set(["action", "reason"]);
	if (action === "continue-agent") return new Set(["action", "continuationFragments"]);
	const keys = new Set(["action", "additionalContexts", "feedbackMessage"]);
	if (eventName === "PreToolUse") keys.add("updatedToolInput");
	if (eventName === "PermissionRequest") {
		keys.add("permissionDecision");
		keys.add("permissionMessage");
	}
	return keys;
}

function assertAllowedKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): void {
	const unexpected = Object.keys(value).find((key) => !allowed.has(key));
	if (unexpected) throw new Error(`Plugin Hook result field ${unexpected} is not allowed`);
}

function emptyEffect(): HookDispatchEffect {
	return {
		shouldStop: false,
		shouldBlock: false,
		additionalContexts: [],
		continuationFragments: [],
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown, field: string): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string") throw new Error(`Plugin Hook ${field} must be a string`);
	const normalized = value.trim();
	return normalized || undefined;
}

function optionalStringArray(value: unknown, field: string): string[] {
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !entry.trim())) {
		throw new Error(`Plugin Hook ${field} must contain non-empty strings`);
	}
	return value.map((entry) => entry.trim());
}
