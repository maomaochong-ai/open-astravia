import type { Static, TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type {
	ModelCallFrame,
	ModelCallFrameCompositionContext,
	RuntimeSnapshotAcquireContext,
	RuntimeToolDefinition,
} from "@vetta/runtime-core/kernel";
import {
	CODING_TOOL_SCOPES,
	type CodingToolActivation,
	selectCodingToolRegistrations,
} from "@vetta/runtime-tools/coding";
import { type ContributionLease, DynamicContributionCatalog } from "../../interception/contribution-catalog.js";
import { applySystemPromptOperations, type SystemPromptDraft } from "../../model-context/index.js";
import { resolveToolCategory } from "../../profiles/index.js";
import type {
	CodingAgentExtensionRunnerPort,
	CodingAgentExtensionToolSource,
	CodingAgentRuntimeToolRegistration,
} from "../../runtime-contracts/index.js";
import type { RegisteredTool } from "../index.js";
import { ExtensionRunnerGenerationOwner } from "./extension-runner-generations.js";

export interface CodingAgentExtensionToolSurface {
	readonly frame: ModelCallFrame;
	readonly availableTools: ReadonlyMap<string, RuntimeToolDefinition>;
}

interface AdaptedExtensionToolRegistration extends CodingAgentRuntimeToolRegistration {
	readonly extensionPath: string;
	readonly definition: RegisteredTool["definition"];
}

/**
 * 进程级 Extension Tool 注册表与 Session Runner 绑定。
 *
 * 注册定义在 Composition 创建时按 Legacy first-wins 规则冻结；执行上下文按 request.sessionId
 * 解析到对应 Session Runner。工具只在当前模型调用 Frame 中覆盖同名能力，不进入 Runtime Core。
 */
export class CodingAgentExtensionToolRuntime {
	readonly runnerGenerations = new ExtensionRunnerGenerationOwner();
	private readonly processCatalog = new DynamicContributionCatalog<AdaptedExtensionToolRegistration>();
	private readonly processSourceLeases = new Map<string, ContributionLease>();
	private processRevision = 0;
	private registrations: readonly AdaptedExtensionToolRegistration[] = [];
	private registrationsByName: ReadonlyMap<string, AdaptedExtensionToolRegistration> = new Map();
	private readonly sessionRegistrations = new Map<
		string,
		{
			readonly registrations: readonly AdaptedExtensionToolRegistration[];
			readonly registrationsByName: ReadonlyMap<string, AdaptedExtensionToolRegistration>;
		}
	>();
	private readonly runners = new Map<string, CodingAgentExtensionRunnerPort>();

	constructor(extensions: readonly CodingAgentExtensionToolSource[]) {
		this.refresh(extensions);
	}

	refresh(extensions: readonly CodingAgentExtensionToolSource[]): void {
		const sources = new Map<
			string,
			Array<{ readonly localId: string; readonly order: number; readonly value: AdaptedExtensionToolRegistration }>
		>();
		for (const [sourceIndex, extension] of extensions.entries()) {
			for (const [toolIndex, tool] of [...extension.tools.values()].entries()) {
				const contributions = sources.get(tool.extensionPath) ?? [];
				contributions.push({
					localId: tool.definition.name,
					order: sourceIndex * 1_000_000 + toolIndex,
					value: this.adaptTool(tool),
				});
				sources.set(tool.extensionPath, contributions);
			}
		}
		const nextSources = new Set<string>();
		for (const [sourceId, contributions] of sources) {
			nextSources.add(sourceId);
			const lease = this.processCatalog.replaceSource(sourceId, String(++this.processRevision), contributions);
			this.processSourceLeases.get(sourceId)?.release();
			this.processSourceLeases.set(sourceId, lease);
		}
		for (const [sourceId, lease] of this.processSourceLeases) {
			if (nextSources.has(sourceId)) continue;
			lease.release();
			this.processSourceLeases.delete(sourceId);
		}

		const registrationsByName = new Map<string, AdaptedExtensionToolRegistration>();
		for (const { value } of this.processCatalog.snapshot()) {
			if (!registrationsByName.has(value.tool.name)) registrationsByName.set(value.tool.name, value);
		}
		this.registrations = Object.freeze([...registrationsByName.values()]);
		this.registrationsByName = new Map(
			this.registrations.map((registration) => [registration.tool.name, registration]),
		);
	}

	hasTools(sessionId?: string): boolean {
		return this.readRegistrations(sessionId).length > 0;
	}

	hasTool(toolName: string, sessionId?: string): boolean {
		return this.readRegistrationsByName(sessionId).has(toolName);
	}

	readAvailableTools(sessionId?: string): ReadonlyMap<string, RuntimeToolDefinition> {
		return new Map(this.readRegistrations(sessionId).map(({ tool }) => [tool.name, tool]));
	}

	readActiveToolNames(activation: CodingToolActivation, sessionId?: string): readonly string[] {
		return selectCodingToolRegistrations(this.readRegistrations(sessionId), activation).map(({ tool }) => tool.name);
	}

	bindForTurn(context: RuntimeSnapshotAcquireContext) {
		context.signal.throwIfAborted();
		const runnerLease = this.runnerGenerations.acquire(context.sessionId, context.operationId);
		const registrations = Object.freeze(
			this.readRegistrations(context.sessionId).map((registration) =>
				runnerLease ? bindRegistrationToRunner(registration, runnerLease.runner) : registration,
			),
		);
		const registrationsByName = new Map(registrations.map((registration) => [registration.tool.name, registration]));
		const bound = {
			bindForTurn: () => bound,
			releaseTurnBinding: () => runnerLease?.release(),
			compose: (
				compositionContext: ModelCallFrameCompositionContext,
				baseAvailableTools: ReadonlyMap<string, RuntimeToolDefinition>,
				activation: CodingToolActivation,
			) =>
				this.composeRegistrations(
					registrations,
					registrationsByName,
					compositionContext,
					baseAvailableTools,
					activation,
				),
			contributePrompt: (
				draft: SystemPromptDraft,
				input: { readonly sessionId: string; readonly activeToolNames: readonly string[] },
			) => this.contributePromptRegistrations(registrationsByName, draft, input.activeToolNames),
		};
		return bound;
	}

	compose(
		context: ModelCallFrameCompositionContext,
		baseAvailableTools: ReadonlyMap<string, RuntimeToolDefinition>,
		activation: CodingToolActivation,
	): CodingAgentExtensionToolSurface {
		const registrations = this.readRegistrations(context.sessionId);
		const registrationsByName = this.readRegistrationsByName(context.sessionId);
		return this.composeRegistrations(registrations, registrationsByName, context, baseAvailableTools, activation);
	}

	private composeRegistrations(
		registrations: readonly AdaptedExtensionToolRegistration[],
		registrationsByName: ReadonlyMap<string, AdaptedExtensionToolRegistration>,
		context: ModelCallFrameCompositionContext,
		baseAvailableTools: ReadonlyMap<string, RuntimeToolDefinition>,
		activation: CodingToolActivation,
	): CodingAgentExtensionToolSurface {
		const availableTools = new Map(baseAvailableTools);
		const activeTools = new Map<string, RuntimeToolDefinition>();
		const selected = new Set(selectCodingToolRegistrations(registrations, activation).map(({ tool }) => tool.name));

		for (const { tool } of registrations) {
			availableTools.set(tool.name, tool);
			if (selected.has(tool.name)) activeTools.set(tool.name, tool);
		}
		for (const [name, tool] of context.frame.tools) {
			if (!registrationsByName.has(name)) activeTools.set(name, tool);
		}

		return {
			frame: { instructions: context.frame.instructions, tools: activeTools },
			availableTools,
		};
	}

	contributePrompt(
		draft: SystemPromptDraft,
		input: { readonly sessionId: string; readonly activeToolNames: readonly string[] },
	): SystemPromptDraft {
		const registrations = this.readRegistrationsByName(input.sessionId);
		return this.contributePromptRegistrations(registrations, draft, input.activeToolNames);
	}

	private contributePromptRegistrations(
		registrations: ReadonlyMap<string, AdaptedExtensionToolRegistration>,
		draft: SystemPromptDraft,
		activeToolNames: readonly string[],
	): SystemPromptDraft {
		let nextDraft = draft;
		for (const toolName of activeToolNames) {
			const registration = registrations.get(toolName);
			const prompt = registration?.definition.prompt;
			if (!registration || !prompt) continue;
			const summary = prompt.summary?.trim();
			const guidelines = (prompt.guidelines ?? []).map((value) => value.trim()).filter(Boolean);
			const operations = [
				...(summary
					? [
							{
								type: "addBlock" as const,
								block: extensionPromptBlock(
									`extension.tool.${toolName}.summary`,
									`Tool guidance for ${toolName}:\n${summary}`,
									250,
								),
							},
						]
					: []),
				...(guidelines.length > 0
					? [
							{
								type: "addBlock" as const,
								block: extensionPromptBlock(
									`extension.tool.${toolName}.guidelines`,
									`Guidelines for ${toolName}:\n${guidelines.map((value) => `- ${value}`).join("\n")}`,
									325,
								),
							},
						]
					: []),
			];
			if (operations.length > 0) {
				nextDraft = applySystemPromptOperations(nextDraft, registration.extensionPath, operations);
			}
		}
		return nextDraft;
	}

	/** 原子替换单个 Session 的工具 Overlay；同名 Session 工具覆盖进程级 Extension 工具。 */
	replaceSessionTools(sessionId: string, tools: readonly RegisteredTool[]): void {
		const registrationsByName = new Map<string, AdaptedExtensionToolRegistration>();
		for (const tool of tools) registrationsByName.set(tool.definition.name, this.adaptTool(tool));
		this.sessionRegistrations.set(sessionId, {
			registrations: Object.freeze([...registrationsByName.values()]),
			registrationsByName,
		});
	}

	clearSessionTools(sessionId: string): void {
		this.sessionRegistrations.delete(sessionId);
	}

	bindRunner(
		sessionId: string,
		runner: CodingAgentExtensionRunnerPort,
		options: { readonly replaceExisting?: boolean } = {},
	): () => Promise<void> {
		const releaseGeneration = this.runnerGenerations.bind(sessionId, runner, options);
		this.runners.set(sessionId, runner);
		return async () => {
			for (const [boundSessionId, candidate] of this.runners) {
				if (candidate === runner) this.runners.delete(boundSessionId);
			}
			await releaseGeneration();
		};
	}

	rebindSession(previousSessionId: string, nextSessionId: string): void {
		if (previousSessionId === nextSessionId) return;
		const sessionTools = this.sessionRegistrations.get(previousSessionId);
		const existingTools = this.sessionRegistrations.get(nextSessionId);
		if (sessionTools && existingTools && existingTools !== sessionTools) {
			throw new Error(`Session tool overlay is already bound: ${nextSessionId}`);
		}
		const runner = this.runners.get(previousSessionId);
		const existing = this.runners.get(nextSessionId);
		if (runner && existing && existing !== runner) {
			throw new Error(`Extension tool runner is already bound: ${nextSessionId}`);
		}
		if (sessionTools) {
			this.sessionRegistrations.delete(previousSessionId);
			this.sessionRegistrations.set(nextSessionId, sessionTools);
		}
		if (runner) {
			this.runners.delete(previousSessionId);
			this.runners.set(nextSessionId, runner);
		}
	}

	private readRegistrations(sessionId: string | undefined): readonly AdaptedExtensionToolRegistration[] {
		if (!sessionId) return this.registrations;
		const session = this.sessionRegistrations.get(sessionId);
		if (!session || session.registrations.length === 0) return this.registrations;
		const combined = new Map(this.registrations.map((registration) => [registration.tool.name, registration]));
		for (const registration of session.registrations) combined.set(registration.tool.name, registration);
		return [...combined.values()];
	}

	private readRegistrationsByName(
		sessionId: string | undefined,
	): ReadonlyMap<string, AdaptedExtensionToolRegistration> {
		if (!sessionId) return this.registrationsByName;
		const session = this.sessionRegistrations.get(sessionId);
		if (!session || session.registrationsByName.size === 0) return this.registrationsByName;
		return new Map([...this.registrationsByName, ...session.registrationsByName]);
	}

	private adaptTool(registeredTool: RegisteredTool): AdaptedExtensionToolRegistration {
		const { definition } = registeredTool;
		const normalizeInput = definition.normalizeInput;
		const validateInput = definition.validateInput;
		return {
			extensionPath: registeredTool.extensionPath,
			definition,
			tool: {
				name: definition.name,
				label: definition.label,
				description: definition.description,
				inputSchema: definition.parameters,
				...(normalizeInput || validateInput
					? {
							validateInput: (input: Record<string, unknown>) => {
								const normalized = normalizeInput ? normalizeInput(input) : input;
								return validateInput
									? assertObjectInput(validateInput(normalized))
									: decodeNormalizedInput(definition.parameters, normalized);
							},
						}
					: {}),
				execute: async (request) => {
					const runner = this.runners.get(request.sessionId);
					if (!runner) {
						throw new Error(`Extension tool runner is not bound: ${request.sessionId}`);
					}
					return definition.execute(
						request.toolCallId,
						request.input as Static<TSchema>,
						request.signal,
						request.onUpdate,
						runner.createContext(),
					);
				},
			},
			scopeUse: definition.scope_use ?? CODING_TOOL_SCOPES,
			requires: definition.requires,
			category: resolveToolCategory(definition.category),
		};
	}
}

function bindRegistrationToRunner(
	registration: AdaptedExtensionToolRegistration,
	runner: CodingAgentExtensionRunnerPort,
): AdaptedExtensionToolRegistration {
	return {
		...registration,
		tool: {
			...registration.tool,
			execute: (request) =>
				registration.definition.execute(
					request.toolCallId,
					request.input as Static<TSchema>,
					request.signal,
					request.onUpdate,
					runner.createContext(),
				),
		},
	};
}

function decodeNormalizedInput(schema: TSchema, input: unknown): Readonly<Record<string, unknown>> {
	const errors = [...Value.Errors(schema, input)];
	if (errors.length > 0) {
		throw new Error(errors.map((error) => `${error.path || "/"}: ${error.message}`).join("; "));
	}
	const decoded: unknown = Value.Decode(schema, input);
	if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
		throw new Error("Extension tool input schema must decode to an object");
	}
	return decoded as Readonly<Record<string, unknown>>;
}

function assertObjectInput(input: unknown): Readonly<Record<string, unknown>> {
	if (typeof input !== "object" || input === null || Array.isArray(input)) {
		throw new Error("Extension tool input validator must return an object");
	}
	return input as Readonly<Record<string, unknown>>;
}

function extensionPromptBlock(id: string, content: string, priority: number) {
	return {
		id,
		type: "plugin" as const,
		source: { kind: "plugin" as const },
		content,
		priority,
		enabled: true,
	};
}
