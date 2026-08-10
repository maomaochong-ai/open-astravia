import type { Message } from "@vetta/ai";
import type { ModelCallFrameCompositionContext } from "@vetta/runtime-core/kernel";
import type { CodingAgentToolInterceptor } from "../../interception/tool/contracts.js";
import type {
	AgentPluginHookContribution,
	AgentPluginHookInvocation,
	AgentPluginHookPoint,
	AgentPluginHookResult,
} from "../../model-context/index.js";
import type { CodingAgentPluginRuntimeSource } from "../../runtime-contracts/index.js";
import type { CodingAgentPluginRunOrchestrator } from "./run-orchestrator.js";
import { validatePluginHookHandlerResult } from "./runtime-effect-schema.js";

const DEFAULT_PLUGIN_HOOK_TIMEOUT_MS = 3_000;

interface PluginHookDispatchSnapshot {
	readonly before: readonly AgentPluginHookContribution[];
	readonly after: readonly AgentPluginHookContribution[];
	readonly error: readonly AgentPluginHookContribution[];
}

export interface CodingAgentPluginHookRuntimeOptions extends CodingAgentPluginRuntimeSource {
	readonly runOrchestrator: CodingAgentPluginRunOrchestrator;
	readonly readAgentMode: () => string | undefined;
	readonly now?: () => number;
	readonly onHookFailure?: (failure: {
		readonly pluginId: string;
		readonly hookId: string;
		readonly point: AgentPluginHookPoint;
		readonly error: unknown;
	}) => void;
}

/** Desktop Plugin Hook 到统一 Tool Interception Pipeline 的产品适配器。 */
export class CodingAgentPluginHookRuntime implements CodingAgentToolInterceptor {
	private readonly now: () => number;

	constructor(private readonly options: CodingAgentPluginHookRuntimeOptions) {
		this.now = options.now ?? Date.now;
	}

	async before(context: Parameters<NonNullable<CodingAgentToolInterceptor["before"]>>[0]) {
		let input = context.input;
		const snapshot = this.snapshot(context.tool.name);
		for (const contribution of snapshot.before) {
			try {
				const outcome = await this.invoke(contribution, context.frameContext, context.request, {
					kind: "tool.before",
					timestamp: this.now(),
					toolCallId: context.request.toolCallId,
					toolName: context.tool.name,
					input: { ...input },
				});
				if (outcome?.action === "block") return { block: { reason: outcome.reason } };
				if (outcome?.action === "continue" && outcome.input) input = outcome.input;
			} catch (error) {
				this.reportFailure(contribution, error);
			}
		}
		return input === context.input ? { state: snapshot } : { input, state: snapshot };
	}

	async after(context: Parameters<NonNullable<CodingAgentToolInterceptor["after"]>>[0]) {
		let result = context.result;
		const contributions = readSnapshot(context.state)?.after ?? this.snapshot(context.tool.name).after;
		for (const contribution of contributions) {
			try {
				const outcome = await this.invoke(contribution, context.frameContext, context.request, {
					kind: "tool.after",
					timestamp: this.now(),
					toolCallId: context.request.toolCallId,
					toolName: context.tool.name,
					input: { ...context.input },
					result: { content: result.content.map(toPluginContent), details: result.details },
				});
				if (outcome?.action === "block") return { block: { reason: outcome.reason } };
				if (outcome?.action === "replace") {
					result = {
						content: outcome.content?.map(toRuntimeContent) ?? result.content,
						details: "details" in outcome ? outcome.details : result.details,
					};
				}
			} catch (error) {
				this.reportFailure(contribution, error);
			}
		}
		return result === context.result ? undefined : { result };
	}

	async onError(context: Parameters<NonNullable<CodingAgentToolInterceptor["onError"]>>[0]) {
		const feedback: string[] = [];
		const contributions = readSnapshot(context.state)?.error ?? this.snapshot(context.tool.name).error;
		for (const contribution of contributions) {
			try {
				const outcome = await this.invoke(contribution, context.frameContext, context.request, {
					kind: "tool.error",
					timestamp: this.now(),
					toolCallId: context.request.toolCallId,
					toolName: context.tool.name,
					input: { ...context.input },
					error: context.error instanceof Error ? context.error.message : String(context.error),
					aborted: context.request.signal.aborted,
				});
				if (outcome?.action === "feedback" && outcome.text.trim()) feedback.push(outcome.text.trim());
			} catch (error) {
				this.reportFailure(contribution, error);
			}
		}
		if (feedback.length === 0) return undefined;
		const message = context.error instanceof Error ? context.error.message : String(context.error);
		return { error: new Error(`${message}\n\n${feedback.join("\n\n")}`) };
	}

	private snapshot(toolName: string): PluginHookDispatchSnapshot {
		const agentMode = this.options.readAgentMode();
		const matching = [...(this.options.readAgentPlugins()?.hookContributions ?? [])]
			.filter((contribution) => contribution.scope_use?.includes(this.readScenario()) === true)
			.filter(
				(contribution) =>
					!contribution.agent_mode?.length ||
					(agentMode !== undefined && contribution.agent_mode.includes(agentMode)),
			)
			.filter((contribution) => !contribution.toolNames?.length || contribution.toolNames.includes(toolName))
			.sort((left, right) => left.pluginId.localeCompare(right.pluginId) || left.id.localeCompare(right.id));
		return {
			before: matching.filter((contribution) => contribution.point === "tool.before"),
			after: matching.filter((contribution) => contribution.point === "tool.after"),
			error: matching.filter((contribution) => contribution.point === "tool.error"),
		};
	}

	private readScenario(): string {
		return this.options.runOrchestrator.readSession().scenario;
	}

	private async invoke(
		contribution: AgentPluginHookContribution,
		frameContext: ModelCallFrameCompositionContext | undefined,
		request: { readonly turnId: string; readonly messages?: readonly Message[]; readonly signal: AbortSignal },
		trigger: AgentPluginHookInvocation["trigger"],
	): Promise<AgentPluginHookResult | undefined> {
		const invoke = this.options.invokeHook;
		if (!invoke || !frameContext) return undefined;
		const rawResult = await invokeWithTimeout(
			(signal) =>
				invoke(
					{
						pluginId: contribution.pluginId,
						hookId: contribution.id,
						handlerId: contribution.handlerId,
						point: contribution.point,
						...this.options.runOrchestrator.createToolHandlerContext({
							turnId: request.turnId,
							messages: request.messages ?? frameContext.messages,
							modelBinding: frameContext.modelBinding,
							includeMessages: contribution.context?.conversation === "messages",
						}),
						trigger,
					} as AgentPluginHookInvocation,
					signal,
				),
			request.signal,
			contribution.timeoutMs ?? DEFAULT_PLUGIN_HOOK_TIMEOUT_MS,
		);
		const result = validatePluginHookHandlerResult(rawResult, contribution.point);
		this.options.runOrchestrator.commitToolEffects(request.turnId, contribution.pluginId, result.effects);
		return result.value;
	}

	private reportFailure(contribution: AgentPluginHookContribution, error: unknown): void {
		this.options.onHookFailure?.({
			pluginId: contribution.pluginId,
			hookId: contribution.id,
			point: contribution.point,
			error,
		});
		if (!this.options.onHookFailure) {
			console.warn(`[plugin-agent] hook failed: ${contribution.pluginId}/${contribution.id}`, error);
		}
	}
}

function readSnapshot(value: unknown): PluginHookDispatchSnapshot | undefined {
	if (!value || typeof value !== "object") return undefined;
	const candidate = value as Partial<PluginHookDispatchSnapshot>;
	return Array.isArray(candidate.before) && Array.isArray(candidate.after) && Array.isArray(candidate.error)
		? (candidate as PluginHookDispatchSnapshot)
		: undefined;
}

function toPluginContent(content: { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }) {
	return content.type === "text"
		? { type: "text" as const, text: content.text }
		: { type: "image" as const, data: content.data, mimeType: content.mimeType };
}

function toRuntimeContent(content: ReturnType<typeof toPluginContent>) {
	return content;
}

async function invokeWithTimeout<T>(
	invoke: (signal: AbortSignal) => Promise<T>,
	signal: AbortSignal,
	timeoutMs: number,
): Promise<T> {
	const controller = new AbortController();
	const onAbort = (): void => controller.abort(signal.reason);
	if (signal.aborted) controller.abort(signal.reason);
	else signal.addEventListener("abort", onAbort, { once: true });
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		const timeoutPromise = new Promise<never>((_resolve, reject) => {
			timeout = setTimeout(() => {
				controller.abort();
				reject(new Error(`Plugin hook timed out after ${timeoutMs}ms`));
			}, timeoutMs);
		});
		return await Promise.race([invoke(controller.signal), timeoutPromise]);
	} finally {
		if (timeout) clearTimeout(timeout);
		signal.removeEventListener("abort", onAbort);
	}
}
