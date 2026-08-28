import type { Message } from "@vetta/ai";
import type { SessionConfig, SessionExecutionMode } from "@vetta/runtime-core";
import type { SessionExtensionFunctionSource } from "@vetta/runtime-core/session-extensions";
import type { CodingAgentKnowledgeWriteOperations } from "../../features/knowledge/contracts.js";
import type {
	AgentPluginContinuationInvoker,
	AgentPluginRuntimeConfig,
	AgentPluginSystemPromptInvoker,
	AgentPluginToolInvoker,
	AgentPluginTurnHandlerLeaseProvider,
} from "../../model-context/plugin-runtime.js";
import type {
	CodingAgentRuntimeToolRegistration,
	CodingAgentSessionToolRegistration,
} from "../../runtime-contracts/index.js";

export type CodingAgentInitialTodoLockSource = "scene";

export interface CodingAgentRuntimeSessionOptions {
	readonly sessionId: string;
	readonly cwd?: string;
	readonly model?: NonNullable<SessionConfig["model"]>;
	readonly thinkingLevel?: NonNullable<SessionConfig["thinkingLevel"]>;
	readonly agentMode?: string;
	readonly executionMode?: SessionExecutionMode;
	readonly env?: Readonly<Record<string, string>>;
	readonly enableBackgroundTasks?: boolean;
	readonly includeAgentSkills?: boolean;
	readonly agentPlugins?: AgentPluginRuntimeConfig;
	readonly invokePluginTool?: AgentPluginToolInvoker;
	readonly invokePluginContinuation?: AgentPluginContinuationInvoker;
	readonly invokePluginSystemPrompt?: AgentPluginSystemPromptInvoker;
	readonly pluginTurnHandlerLeaseProvider?: AgentPluginTurnHandlerLeaseProvider;
	/** Session 私有的 typed function 来源；优先于 Composition 默认来源。 */
	readonly sessionExtensionFunctions?: SessionExtensionFunctionSource;
	readonly sandboxHostPath?: string;
	readonly linuxBubblewrapPath?: string;
	readonly macosSandboxExecPath?: string;
	readonly parentSessionPath?: string;
	readonly parentEntryId?: string;
	readonly memoryMode?: boolean;
	readonly memoryFile?: string;
	readonly memoryCharLimit?: number;
	/** 子 Session 内部 Profile 使用；根宿主无需设置。 */
	readonly systemPromptAddon?: string;
	/** Workflow 子 Session 的父分支只读快照。 */
	readonly forkContextMessages?: readonly Message[];
	/** Workflow 子 Session 的初始 Todo。 */
	readonly initialTodos?: readonly string[];
	/** 产品组合创建初始 Todo 后施加的锁；不会暴露可写 TodoStore 给宿主。 */
	readonly initialTodoLockSource?: CodingAgentInitialTodoLockSource;
	/** 产品会话自己的 Knowledge Writer；普通会话继续使用 Composition 默认实现。 */
	readonly knowledgePageWriter?: CodingAgentKnowledgeWriteOperations;
	/** 由产品宿主校验并适配的 Session 私有工具；同名定义覆盖进程级 Extension 工具。 */
	readonly sessionTools?: readonly CodingAgentSessionToolRegistration[];
	/** 仅由产品宿主为单个 Session 注入的中立 Runtime Tool 注册。 */
	readonly sessionRuntimeTools?: readonly CodingAgentRuntimeToolRegistration[];
}

/** Coding Agent Definition 边界的 Session payload 校验。 */
export function requireCodingAgentRuntimeSessionOptions(value: unknown): CodingAgentRuntimeSessionOptions {
	if (!isRecord(value)) {
		throw new Error("Coding Agent Runtime Session requires an object configuration");
	}
	const sessionId = requireNonEmptyString(value.sessionId, "sessionId");
	assertOptionalStringFields(value, [
		"cwd",
		"thinkingLevel",
		"agentMode",
		"executionMode",
		"sandboxHostPath",
		"linuxBubblewrapPath",
		"macosSandboxExecPath",
		"parentSessionPath",
		"parentEntryId",
		"memoryFile",
		"systemPromptAddon",
		"initialTodoLockSource",
	]);
	assertOptionalBooleanFields(value, ["enableBackgroundTasks", "includeAgentSkills", "memoryMode"]);
	assertOptionalNumberFields(value, ["memoryCharLimit"]);
	assertOptionalArrayFields(value, ["forkContextMessages", "initialTodos", "sessionTools", "sessionRuntimeTools"]);
	assertOptionalFunctionFields(value, ["invokePluginTool", "invokePluginContinuation", "invokePluginSystemPrompt"]);
	assertOptionalRecordFields(value, [
		"model",
		"agentPlugins",
		"pluginTurnHandlerLeaseProvider",
		"sessionExtensionFunctions",
		"knowledgePageWriter",
	]);
	if (value.env !== undefined) {
		if (!isRecord(value.env) || Object.values(value.env).some((item) => typeof item !== "string")) {
			throw new Error("Coding Agent Runtime Session field env must contain only string values");
		}
	}
	return { ...value, sessionId } as unknown as CodingAgentRuntimeSessionOptions;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(value: unknown, field: string): string {
	if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
		throw new Error(`Coding Agent Runtime Session field ${field} must be a non-empty trimmed string`);
	}
	return value;
}

function assertOptionalStringFields(value: Record<string, unknown>, fields: readonly string[]): void {
	for (const field of fields) {
		if (value[field] !== undefined && typeof value[field] !== "string") {
			throw new Error(`Coding Agent Runtime Session field ${field} must be a string`);
		}
	}
}

function assertOptionalBooleanFields(value: Record<string, unknown>, fields: readonly string[]): void {
	for (const field of fields) {
		if (value[field] !== undefined && typeof value[field] !== "boolean") {
			throw new Error(`Coding Agent Runtime Session field ${field} must be a boolean`);
		}
	}
}

function assertOptionalNumberFields(value: Record<string, unknown>, fields: readonly string[]): void {
	for (const field of fields) {
		if (value[field] !== undefined && typeof value[field] !== "number") {
			throw new Error(`Coding Agent Runtime Session field ${field} must be a number`);
		}
	}
}

function assertOptionalArrayFields(value: Record<string, unknown>, fields: readonly string[]): void {
	for (const field of fields) {
		if (value[field] !== undefined && !Array.isArray(value[field])) {
			throw new Error(`Coding Agent Runtime Session field ${field} must be an array`);
		}
	}
}

function assertOptionalFunctionFields(value: Record<string, unknown>, fields: readonly string[]): void {
	for (const field of fields) {
		if (value[field] !== undefined && typeof value[field] !== "function") {
			throw new Error(`Coding Agent Runtime Session field ${field} must be a function`);
		}
	}
}

function assertOptionalRecordFields(value: Record<string, unknown>, fields: readonly string[]): void {
	for (const field of fields) {
		if (value[field] !== undefined && !isRecord(value[field])) {
			throw new Error(`Coding Agent Runtime Session field ${field} must be an object`);
		}
	}
}
