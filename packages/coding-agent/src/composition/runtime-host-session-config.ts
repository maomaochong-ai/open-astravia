import type { RuntimeSessionAgentSelection, SessionConfig } from "@vetta/runtime-core";
import { RuntimeHost, RuntimeHostSession } from "@vetta/runtime-core";
import type {
	CodingAgentRuntimeAgentIdentity,
	CodingAgentRuntimeComposition,
	CodingAgentRuntimeSessionOptions,
} from "./contracts/index.js";

export type CodingAgentRuntimeHostSessionOverrides = Pick<
	SessionConfig,
	"agentDir" | "scenario" | "sessionDir" | "sessionPath"
>;

/**
 * 把 Coding Agent 私有 Session 配置绑定到通用 Runtime Agent selection。
 * Runtime Core 只路由并透传 payload，不解释其中任何产品字段。
 */
export function createCodingAgentRuntimeSessionAgentSelection(
	agent: CodingAgentRuntimeAgentIdentity,
	options: CodingAgentRuntimeSessionOptions,
): RuntimeSessionAgentSelection {
	return {
		id: agent.agentId,
		definitionRevisionId: agent.revisionId,
		instanceId: agent.instanceId,
		sessionConfiguration: options,
	};
}

/** Coding Agent 宿主创建 Session 时的唯一通用配置投影。 */
export function createCodingAgentRuntimeHostSessionConfig(
	agent: CodingAgentRuntimeAgentIdentity,
	options: CodingAgentRuntimeSessionOptions,
	overrides: CodingAgentRuntimeHostSessionOverrides = {},
): SessionConfig {
	return {
		...overrides,
		agent: createCodingAgentRuntimeSessionAgentSelection(agent, options),
		sessionId: options.sessionId,
		cwd: options.cwd,
		model: options.model,
		thinkingLevel: options.thinkingLevel,
		agentMode: options.agentMode,
		executionMode: options.executionMode,
		appendSystemPrompt: options.systemPromptAddon,
		env: options.env ? { ...options.env } : undefined,
		enableBackgroundTasks: options.enableBackgroundTasks,
		includeAgentSkills: options.includeAgentSkills,
	};
}

export interface IsolatedCodingAgentRuntimeHostSessionOptions extends CodingAgentRuntimeHostSessionOverrides {
	readonly resume?: boolean;
}

/**
 * 为只需要一个 Coding Agent Session 的嵌入场景创建最小独立 RuntimeHost。
 * 返回 Session 的 dispose 会关闭整个局部 Host；Composition 仍由调用方持有。
 */
export async function createIsolatedCodingAgentRuntimeHostSession(
	composition: CodingAgentRuntimeComposition,
	options: CodingAgentRuntimeSessionOptions,
	hostOptions: IsolatedCodingAgentRuntimeHostSessionOptions = {},
): Promise<RuntimeHostSession> {
	const { resume = false, ...overrides } = hostOptions;
	const runtimeHost = new RuntimeHost({
		sessionBackend: composition.runtimeHostBackend,
		observationPublisher: composition.observations.publisher(),
		// 独立嵌入入口迁移到 RuntimeHost 前默认直接执行工具；保持该兼容合同。
		getDefaultExecutionMode: () => "full-access",
	});
	try {
		const created = await runtimeHost.createSession(
			createCodingAgentRuntimeHostSessionConfig(composition.agentRuntime, options, {
				...overrides,
				...(resume && overrides.sessionPath === undefined ? { sessionPath: options.sessionId } : {}),
			}),
		);
		return new IsolatedCodingAgentRuntimeHostSession(runtimeHost, created.sessionId);
	} catch (error) {
		await runtimeHost.close();
		throw error;
	}
}

class IsolatedCodingAgentRuntimeHostSession extends RuntimeHostSession {
	constructor(
		private readonly ownedHost: RuntimeHost,
		sessionId: string,
	) {
		super(ownedHost, sessionId);
	}

	override dispose(): Promise<void> {
		return this.ownedHost.close();
	}
}
