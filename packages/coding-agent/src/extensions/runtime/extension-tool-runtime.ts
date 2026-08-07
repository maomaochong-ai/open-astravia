import type { Static, TSchema } from "@sinclair/typebox";
import type {
	ModelCallFrame,
	ModelCallFrameCompositionContext,
	RuntimeToolDefinition,
} from "@vetta/runtime-core/kernel";
import {
	CODING_TOOL_SCOPES,
	type CodingToolActivation,
	selectCodingToolRegistrations,
} from "@vetta/runtime-tools/coding";
import { resolveToolCategory } from "../../profiles/index.js";
import type {
	CodingAgentExtensionRunnerPort,
	CodingAgentExtensionToolSource,
	CodingAgentRuntimeToolRegistration,
} from "../../runtime-contracts/index.js";
import type { RegisteredTool } from "../index.js";

export interface CodingAgentExtensionToolSurface {
	readonly frame: ModelCallFrame;
	readonly availableTools: ReadonlyMap<string, RuntimeToolDefinition>;
}

/**
 * 进程级 Extension Tool 注册表与 Session Runner 绑定。
 *
 * 注册定义在 Composition 创建时按 Legacy first-wins 规则冻结；执行上下文按 request.sessionId
 * 解析到对应 Session Runner。工具只在当前模型调用 Frame 中覆盖同名能力，不进入 Runtime Core。
 */
export class CodingAgentExtensionToolRuntime {
	private registrations: readonly CodingAgentRuntimeToolRegistration[] = [];
	private registrationsByName: ReadonlyMap<string, CodingAgentRuntimeToolRegistration> = new Map();
	private readonly sessionRegistrations = new Map<
		string,
		{
			readonly registrations: readonly CodingAgentRuntimeToolRegistration[];
			readonly registrationsByName: ReadonlyMap<string, CodingAgentRuntimeToolRegistration>;
		}
	>();
	private readonly runners = new Map<string, CodingAgentExtensionRunnerPort>();

	constructor(extensions: readonly CodingAgentExtensionToolSource[]) {
		this.refresh(extensions);
	}

	refresh(extensions: readonly CodingAgentExtensionToolSource[]): void {
		this.registrations = Object.freeze(collectRegisteredTools(extensions).map((tool) => this.adaptTool(tool)));
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

	compose(
		context: ModelCallFrameCompositionContext,
		baseAvailableTools: ReadonlyMap<string, RuntimeToolDefinition>,
		activation: CodingToolActivation,
	): CodingAgentExtensionToolSurface {
		const availableTools = new Map(baseAvailableTools);
		const activeTools = new Map<string, RuntimeToolDefinition>();
		const registrations = this.readRegistrations(context.sessionId);
		const registrationsByName = this.readRegistrationsByName(context.sessionId);
		const selected = new Set(this.readActiveToolNames(activation, context.sessionId));

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

	/** 原子替换单个 Session 的工具 Overlay；同名 Session 工具覆盖进程级 Extension 工具。 */
	replaceSessionTools(sessionId: string, tools: readonly RegisteredTool[]): void {
		const registrationsByName = new Map<string, CodingAgentRuntimeToolRegistration>();
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
	): () => void {
		const current = this.runners.get(sessionId);
		if (current && current !== runner && options.replaceExisting !== true) {
			throw new Error(`Extension tool runner is already bound: ${sessionId}`);
		}
		this.runners.set(sessionId, runner);
		return () => {
			for (const [boundSessionId, candidate] of this.runners) {
				if (candidate === runner) this.runners.delete(boundSessionId);
			}
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

	private readRegistrations(sessionId: string | undefined): readonly CodingAgentRuntimeToolRegistration[] {
		if (!sessionId) return this.registrations;
		const session = this.sessionRegistrations.get(sessionId);
		if (!session || session.registrations.length === 0) return this.registrations;
		const combined = new Map(this.registrations.map((registration) => [registration.tool.name, registration]));
		for (const registration of session.registrations) combined.set(registration.tool.name, registration);
		return [...combined.values()];
	}

	private readRegistrationsByName(
		sessionId: string | undefined,
	): ReadonlyMap<string, CodingAgentRuntimeToolRegistration> {
		if (!sessionId) return this.registrationsByName;
		const session = this.sessionRegistrations.get(sessionId);
		if (!session || session.registrationsByName.size === 0) return this.registrationsByName;
		return new Map([...this.registrationsByName, ...session.registrationsByName]);
	}

	private adaptTool(registeredTool: RegisteredTool): CodingAgentRuntimeToolRegistration {
		const { definition } = registeredTool;
		return {
			tool: {
				name: definition.name,
				label: definition.label,
				description: definition.description,
				inputSchema: definition.parameters,
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

function collectRegisteredTools(extensions: readonly CodingAgentExtensionToolSource[]): RegisteredTool[] {
	const toolsByName = new Map<string, RegisteredTool>();
	for (const extension of extensions) {
		for (const tool of extension.tools.values()) {
			if (!toolsByName.has(tool.definition.name)) toolsByName.set(tool.definition.name, tool);
		}
	}
	return [...toolsByName.values()];
}
