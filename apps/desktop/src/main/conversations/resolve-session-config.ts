import { VETTA_CLI_GUIDANCE } from "@vetta/coding-agent/cli-guidance";
import { createCodingAgentRuntimeSessionSelection } from "@vetta/coding-agent/composition";
import type { AgentConfigurationSelection, ConversationScenario } from "@vetta/coding-agent/profile";
import type { CodingAgentRuntimeToolRegistration } from "@vetta/coding-agent/runtime";
import type { SessionConfig } from "@vetta/runtime-core";
import { allowProjectRoot, readDesktopConfig } from "../ipc/fs.js";
import { type DesktopAgentMode, LEGACY_SESSION_AGENT_MODE, readSessionAgentMode } from "./session-agent-mode-store.js";
import {
	ensureConversationSubCwd,
	ensureSessionWorkingCwd,
	readSessionCwdFromHeader,
	resolveSessionDirForCwd,
} from "./session-paths.js";

export type DesktopConversationSource = "interactive" | "debug";
export type DesktopSessionKind = "conversation" | "other";

/** Desktop 的 Coding Agent 产品输入；产品字段不会进入 Runtime Core 的 SessionConfig。 */
export interface DesktopCodingAgentSessionConfig extends SessionConfig {
	readonly scenario?: ConversationScenario;
	readonly agentMode?: DesktopAgentMode;
	readonly appendSystemPrompt?: string;
	readonly enableBackgroundTasks?: boolean;
	readonly includeAgentSkills?: boolean;
	readonly agentConfiguration?: AgentConfigurationSelection;
	readonly sessionRuntimeTools?: readonly CodingAgentRuntimeToolRegistration[];
}

export interface ResolvedDesktopSessionConfig {
	config: SessionConfig;
	cwd: string;
	scenario: ConversationScenario;
	includeAgentSkills: boolean;
	/** 本会话固化的工作模式；创建后由调用方落盘，会话内不可变。 */
	agentMode: DesktopAgentMode;
}

/**
 * 工作模式的唯一来源：
 * - 新建会话取 desktop-config 的 defaultAgentMode（新会话默认值）；
 * - 恢复已有会话取该会话创建时固化的记录，缺记录时回落常量，绝不回落当前默认值，
 *   否则改默认值会连带改写历史会话的模式。
 */
async function resolveSessionAgentMode(
	existingSessionPath: string | undefined,
	defaultAgentMode: DesktopAgentMode,
): Promise<DesktopAgentMode> {
	if (!existingSessionPath) return defaultAgentMode;
	return (await readSessionAgentMode(existingSessionPath)) ?? LEGACY_SESSION_AGENT_MODE;
}

export async function resolveDesktopSessionConfig(
	config: DesktopCodingAgentSessionConfig | undefined,
	kind: DesktopSessionKind,
	source: DesktopConversationSource,
): Promise<ResolvedDesktopSessionConfig> {
	const requestedCwd = config?.cwd ?? process.cwd();
	allowProjectRoot(requestedCwd);
	const injectedSessionDir = config?.sessionDir ?? resolveSessionDirForCwd(requestedCwd);
	const cwdFromExistingHeader = config?.sessionPath ? await readSessionCwdFromHeader(config.sessionPath) : undefined;
	const effectiveCwd = cwdFromExistingHeader ?? (await ensureConversationSubCwd(requestedCwd)) ?? requestedCwd;
	await ensureSessionWorkingCwd(effectiveCwd);
	if (effectiveCwd !== requestedCwd) {
		allowProjectRoot(effectiveCwd);
	}

	const isConversation = kind === "conversation";
	const scenario: ConversationScenario = config?.scenario ?? (isConversation ? "conversation" : "project");
	const desktopConfig = await readDesktopConfig();
	const enableBackgroundTasks = source === "interactive" && scenario !== "batch";
	const includeAgentSkills = desktopConfig.experimental?.agentSkills !== false;
	const appendSystemPrompt =
		isConversation && desktopConfig.experimental?.vettaCli === true
			? config?.appendSystemPrompt
				? `${config.appendSystemPrompt}\n\n${VETTA_CLI_GUIDANCE}`
				: VETTA_CLI_GUIDANCE
			: config?.appendSystemPrompt;
	const agentMode = await resolveSessionAgentMode(config?.sessionPath, desktopConfig.defaultAgentMode ?? "work");
	const {
		scenario: _scenario,
		agentMode: _agentMode,
		appendSystemPrompt: _appendSystemPrompt,
		enableBackgroundTasks: _enableBackgroundTasks,
		includeAgentSkills: _includeAgentSkills,
		agentConfiguration: _agentConfiguration,
		sessionRuntimeTools: _sessionRuntimeTools,
		...runtimeConfig
	} = config ?? {};
	return {
		config: {
			...runtimeConfig,
			agent: createCodingAgentRuntimeSessionSelection(
				{
					sessionId: config?.sessionId,
					scenario,
					agentMode,
					systemPromptAddon: appendSystemPrompt,
					enableBackgroundTasks,
					includeAgentSkills,
					agentConfiguration: config?.agentConfiguration,
					sessionRuntimeTools: config?.sessionRuntimeTools,
				},
				config?.agent,
			),
			cwd: effectiveCwd,
			sessionDir: injectedSessionDir ?? config?.sessionDir,
		},
		cwd: effectiveCwd,
		scenario,
		includeAgentSkills,
		agentMode,
	};
}
