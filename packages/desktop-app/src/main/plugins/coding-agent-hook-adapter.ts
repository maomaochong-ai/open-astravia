import type {
	EcosystemHookAdapterFactory,
	EcosystemHookEvent,
	HookDispatchEffect,
	HookDispatchOutcome,
	HookOutputEntry,
	HookRunSummary,
} from "@vetta/coding-agent/hooks";
import { aggregateHookDispatchOutcomes, emptyHookDispatchOutcome } from "@vetta/coding-agent/hooks";
import type { PluginCodingAgentHookEvent, PluginCodingAgentHookEventName } from "@vetta-org/plugin-sdk";
import { invokeDesktopPluginHook } from "./coding-agent-hook-invocation.js";
import { type DesktopPluginHookBinding, desktopPluginHookRegistry } from "./coding-agent-hook-registry.js";
import { parseDesktopPluginHookResult } from "./coding-agent-hook-result.js";

const DESKTOP_PLUGIN_HOOK_ADAPTER_ID = "desktop-plugin-hooks/1";
const DEFAULT_TIMEOUT_MS = 3_000;

export interface DesktopPluginHookAdapterFactoryOptions {
	readonly scenario: string;
	readonly readAgentMode: () => string | undefined;
	readonly canInvoke: (pluginId: string) => boolean;
}

export function createDesktopPluginHookAdapterFactory(
	options: DesktopPluginHookAdapterFactoryOptions,
): EcosystemHookAdapterFactory {
	return async (context) => {
		const turnBindings = new Map<string, readonly DesktopPluginHookBinding[]>();
		const readBindings = (event: EcosystemHookEvent): readonly DesktopPluginHookBinding[] => {
			const turnId = readTurnId(event);
			if (!turnId) {
				return desktopPluginHookRegistry.snapshot().filter((binding) => matchesBindingScope(binding, options));
			}
			const existing = turnBindings.get(turnId);
			if (existing) return existing;
			// A Session executes one Agent Turn at a time. Retire stale membership when
			// the next turn is first observed, then bind the current published registry.
			turnBindings.clear();
			const captured = Object.freeze(
				desktopPluginHookRegistry.snapshot().filter((binding) => matchesBindingScope(binding, options)),
			);
			turnBindings.set(turnId, captured);
			return captured;
		};
		return {
			id: DESKTOP_PLUGIN_HOOK_ADAPTER_ID,
			supports: (event) => readBindings(event).some((binding) => matchesBindingEvent(binding, event)),
			dispatch: async (event, signal) => {
				const bindings = readBindings(event).filter((binding) => matchesBindingEvent(binding, event));
				if (bindings.length === 0) {
					if (event.eventName === "Stop") turnBindings.delete(event.turnId);
					if (event.eventName === "SessionEnd") turnBindings.clear();
					return emptyHookDispatchOutcome();
				}
				try {
					const outcomes = await Promise.all(
						bindings.map((binding) => dispatchBinding(binding, event, options.scenario, signal)),
					);
					for (const outcome of outcomes) {
						for (const run of outcome.runs) {
							if (run.status === "Failed") context.onFailedRun(run);
						}
					}
					return aggregateHookDispatchOutcomes(outcomes);
				} finally {
					if (event.eventName === "Stop") turnBindings.delete(event.turnId);
					if (event.eventName === "SessionEnd") turnBindings.clear();
				}
			},
		};
	};
}

async function dispatchBinding(
	binding: DesktopPluginHookBinding,
	event: EcosystemHookEvent,
	scenario: string,
	signal?: AbortSignal,
): Promise<HookDispatchOutcome> {
	const startedAtMs = Date.now();
	try {
		const value = await invokeWithTimeout(
			(handlerSignal) =>
				invokeDesktopPluginHook(
					binding,
					{ id: event.sessionId, cwd: event.cwd, scenario },
					toPluginEvent(event),
					handlerSignal,
				),
			signal,
			binding.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		);
		const effect = parseDesktopPluginHookResult(event.eventName, value);
		return {
			...effect,
			runs: [completedRun(binding, event.eventName, startedAtMs, effect)],
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			...emptyHookDispatchOutcome(),
			runs: [failedRun(binding, event.eventName, startedAtMs, message)],
		};
	}
}

function matchesBindingScope(
	binding: DesktopPluginHookBinding,
	options: DesktopPluginHookAdapterFactoryOptions,
): boolean {
	if (!options.canInvoke(binding.pluginId)) return false;
	if (!binding.scope_use.includes(options.scenario)) return false;
	const agentMode = options.readAgentMode();
	if (agentMode && binding.agent_mode?.length && !binding.agent_mode.includes(agentMode)) return false;
	return true;
}

function matchesBindingEvent(binding: DesktopPluginHookBinding, event: EcosystemHookEvent): boolean {
	if (binding.eventName !== event.eventName) return false;
	if (!binding.toolNames?.length) return true;
	const toolName = toolEventName(event);
	return toolName !== undefined && binding.toolNames.includes(toolName);
}

function readTurnId(event: EcosystemHookEvent): string | undefined {
	return "turnId" in event && typeof event.turnId === "string" ? event.turnId : undefined;
}

function toolEventName(event: EcosystemHookEvent): string | undefined {
	switch (event.eventName) {
		case "PreToolUse":
		case "PermissionRequest":
		case "PostToolUse":
		case "PostToolUseFailure":
			return event.tool.hostName;
		default:
			return undefined;
	}
}

function toPluginEvent(event: EcosystemHookEvent): PluginCodingAgentHookEvent {
	const common = {
		sessionId: event.sessionId,
		cwd: event.cwd,
		model: event.model,
		permissionMode: event.permissionMode,
		subagent: event.subagent,
	};
	switch (event.eventName) {
		case "SessionStart":
			return { ...common, eventName: event.eventName, source: event.source };
		case "SessionEnd":
			return { ...common, eventName: event.eventName, cause: event.cause };
		case "UserPromptSubmit":
			return { ...common, eventName: event.eventName, turnId: event.turnId, prompt: event.prompt };
		case "PreToolUse":
			return {
				...common,
				eventName: event.eventName,
				turnId: event.turnId,
				tool: event.tool,
				toolUseId: event.toolUseId,
				toolInput: event.toolInput,
			};
		case "PermissionRequest":
			return {
				...common,
				eventName: event.eventName,
				turnId: event.turnId,
				tool: event.tool,
				toolInput: event.toolInput,
				runIdSuffix: event.runIdSuffix,
			};
		case "PostToolUse":
			return {
				...common,
				eventName: event.eventName,
				turnId: event.turnId,
				tool: event.tool,
				toolUseId: event.toolUseId,
				toolInput: event.toolInput,
				toolResponse: event.toolResponse,
			};
		case "PostToolUseFailure":
			return {
				...common,
				eventName: event.eventName,
				turnId: event.turnId,
				tool: event.tool,
				toolUseId: event.toolUseId,
				toolInput: event.toolInput,
				error: event.error,
				isInterrupt: event.isInterrupt,
				durationMs: event.durationMs,
			};
		case "PreCompact":
		case "PostCompact":
			return { ...common, eventName: event.eventName, turnId: event.turnId, trigger: event.trigger };
		case "SubagentStart":
			return {
				...common,
				eventName: event.eventName,
				turnId: event.turnId,
				agentId: event.agentId,
				agentType: event.agentType,
			};
		case "SubagentStop":
			return {
				...common,
				eventName: event.eventName,
				turnId: event.turnId,
				agentId: event.agentId,
				agentType: event.agentType,
				stopHookActive: event.stopHookActive,
				lastAssistantMessage: event.lastAssistantMessage,
			};
		case "Stop":
			return {
				...common,
				eventName: event.eventName,
				turnId: event.turnId,
				stopHookActive: event.stopHookActive,
				lastAssistantMessage: event.lastAssistantMessage,
			};
	}
}

function completedRun(
	binding: DesktopPluginHookBinding,
	eventName: PluginCodingAgentHookEventName,
	startedAtMs: number,
	effect: HookDispatchEffect,
): HookRunSummary {
	const entries: HookOutputEntry[] = [
		...(effect.stopReason ? [{ kind: "Stop" as const, text: effect.stopReason }] : []),
		...(effect.blockReason ? [{ kind: "Warning" as const, text: effect.blockReason }] : []),
		...(effect.feedbackMessage ? [{ kind: "Feedback" as const, text: effect.feedbackMessage }] : []),
		...effect.additionalContexts.map((text) => ({ kind: "Context" as const, text })),
	];
	return baseRun(binding, eventName, startedAtMs, {
		status: effect.shouldStop ? "Stopped" : effect.shouldBlock ? "Blocked" : "Completed",
		entries,
	});
}

function failedRun(
	binding: DesktopPluginHookBinding,
	eventName: PluginCodingAgentHookEventName,
	startedAtMs: number,
	message: string,
): HookRunSummary {
	return baseRun(binding, eventName, startedAtMs, {
		status: "Failed",
		entries: [{ kind: "Error", text: message }],
	});
}

function baseRun(
	binding: DesktopPluginHookBinding,
	eventName: PluginCodingAgentHookEventName,
	startedAtMs: number,
	result: Pick<HookRunSummary, "status" | "entries">,
): HookRunSummary {
	const completedAtMs = Date.now();
	return {
		id: `${eventName}:${binding.pluginId}:${binding.id}`,
		profileId: DESKTOP_PLUGIN_HOOK_ADAPTER_ID,
		eventName,
		handlerType: "callback",
		executionMode: "sync",
		scope: eventName === "SessionStart" || eventName === "SessionEnd" ? "session" : "turn",
		sourcePath: `plugin://${binding.pluginId}/${binding.id}`,
		displayOrder: binding.order,
		startedAt: Math.floor(startedAtMs / 1_000),
		completedAt: Math.floor(completedAtMs / 1_000),
		durationMs: completedAtMs - startedAtMs,
		...result,
	};
}

async function invokeWithTimeout<T>(
	invoke: (signal: AbortSignal) => Promise<T>,
	parentSignal: AbortSignal | undefined,
	timeoutMs: number,
): Promise<T> {
	const controller = new AbortController();
	const onAbort = () => controller.abort(parentSignal?.reason);
	parentSignal?.addEventListener("abort", onAbort, { once: true });
	const timeout = setTimeout(
		() => controller.abort(new Error(`Plugin Hook timed out after ${timeoutMs}ms`)),
		timeoutMs,
	);
	let rejectOnAbort: ((reason?: unknown) => void) | undefined;
	const aborted = new Promise<never>((_resolve, reject) => {
		rejectOnAbort = reject;
	});
	const onInvocationAbort = () => rejectOnAbort?.(controller.signal.reason);
	controller.signal.addEventListener("abort", onInvocationAbort, { once: true });
	try {
		if (parentSignal?.aborted) controller.abort(parentSignal.reason);
		if (controller.signal.aborted) throw controller.signal.reason;
		return await Promise.race([invoke(controller.signal), aborted]);
	} finally {
		clearTimeout(timeout);
		parentSignal?.removeEventListener("abort", onAbort);
		controller.signal.removeEventListener("abort", onInvocationAbort);
	}
}
