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
import {
	type DesktopPluginHookBinding,
	type DesktopPluginHookSnapshotLease,
	desktopPluginHookRegistry,
} from "./coding-agent-hook-registry.js";
import { parseDesktopPluginHookResult } from "./coding-agent-hook-result.js";

const DESKTOP_PLUGIN_HOOK_ADAPTER_ID = "desktop-plugin-hooks/1";
const DEFAULT_TIMEOUT_MS = 3_000;

export interface DesktopPluginHookAdapterFactoryOptions {
	readonly scenario: string;
	readonly canInvoke: (pluginId: string) => boolean;
}

export function createDesktopPluginHookAdapterFactory(
	options: DesktopPluginHookAdapterFactoryOptions,
): EcosystemHookAdapterFactory {
	return async (context) => {
		const leases = new Map<string, DesktopPluginHookSnapshotLease>();
		const leaseKey = (event: EcosystemHookEvent): string => readTurnId(event) ?? `session:${event.eventName}`;
		const releaseLease = (event: EcosystemHookEvent): void => {
			const key = leaseKey(event);
			leases.get(key)?.release();
			leases.delete(key);
		};
		const releaseAll = (): void => {
			for (const lease of leases.values()) lease.release();
			leases.clear();
		};
		const readBindings = (event: EcosystemHookEvent): readonly DesktopPluginHookBinding[] => {
			const turnId = readTurnId(event);
			const key = leaseKey(event);
			const existing = leases.get(key);
			if (existing) return existing.bindings;
			// A Session executes one Agent Turn at a time. Retire stale membership when
			// the next turn is first observed, then bind the current published registry.
			if (turnId) releaseAll();
			const captured = desktopPluginHookRegistry.acquireSnapshot((binding) => matchesBindingScope(binding, options));
			leases.set(key, captured);
			return captured.bindings;
		};
		return {
			id: DESKTOP_PLUGIN_HOOK_ADAPTER_ID,
			supports: (event) => {
				const supported = readBindings(event).some((binding) => matchesBindingEvent(binding, event));
				if (!supported && !readTurnId(event)) releaseLease(event);
				return supported;
			},
			dispatch: async (event, signal) => {
				const bindings = readBindings(event).filter((binding) => matchesBindingEvent(binding, event));
				if (bindings.length === 0) {
					if (event.eventName === "Stop") releaseLease(event);
					if (!readTurnId(event)) releaseLease(event);
					if (event.eventName === "SessionEnd") releaseAll();
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
					if (event.eventName === "Stop") releaseLease(event);
					if (!readTurnId(event)) releaseLease(event);
					if (event.eventName === "SessionEnd") releaseAll();
				}
			},
			resetSessionState: releaseAll,
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
	// 工作模式不再过滤 hook（用户决策：零硬闸）。binding.agent_mode 仅保留为声明，
	// hook 是否触发只由 canInvoke、scope_use 以及自身的事件/工具 matcher 决定。
	if (!options.canInvoke(binding.pluginId)) return false;
	return binding.scope_use.includes(options.scenario);
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
