import { VETTA_CLI_GUIDANCE } from "@vetta/coding-agent/product-prompt";
import type { ConversationScenario } from "@vetta/coding-agent/profile";
import type { SessionConfig } from "@vetta/runtime-core";
import { allowProjectRoot, readDesktopConfig } from "../ipc/fs.js";
import { getAppLogger } from "../logger.js";
import { pluginAgentContributionService } from "../plugins/plugin-catalog.js";
import { summarizeAgentPluginRuntimeConfig } from "../plugins/plugin-runtime-config-builder.js";
import { type DesktopAgentMode, LEGACY_SESSION_AGENT_MODE, readSessionAgentMode } from "./session-agent-mode-store.js";
import {
	ensureConversationSubCwd,
	ensureSessionWorkingCwd,
	readSessionCwdFromHeader,
	resolveSessionDirForCwd,
} from "./session-paths.js";

const pluginLog = getAppLogger("plugin");

export type DesktopConversationSource = "interactive" | "debug";
export type DesktopSessionKind = "conversation" | "other";

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
	config: SessionConfig | undefined,
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
	const askUserQuestion = scenario === "conversation" || scenario === "project";
	const enableBackgroundTasks = source === "interactive" && scenario !== "batch";
	const includeAgentSkills = desktopConfig.experimental?.agentSkills !== false;
	const appendSystemPrompt =
		isConversation && desktopConfig.experimental?.vettaCli === true
			? config?.appendSystemPrompt
				? `${config.appendSystemPrompt}\n\n${VETTA_CLI_GUIDANCE}`
				: VETTA_CLI_GUIDANCE
			: config?.appendSystemPrompt;
	const agentMode = await resolveSessionAgentMode(config?.sessionPath, desktopConfig.defaultAgentMode ?? "work");
	const agentPlugins = pluginAgentContributionService.buildRuntimeConfig();
	pluginLog.debug("session create plugin snapshot", {
		kind,
		source,
		isConversation,
		...summarizeAgentPluginRuntimeConfig(agentPlugins),
	});

	return {
		config: {
			...(config ?? {}),
			cwd: effectiveCwd,
			sessionDir: injectedSessionDir ?? config?.sessionDir,
			scenario,
			agentMode,
			appendSystemPrompt,
			askUserQuestion,
			enableBackgroundTasks,
			includeAgentSkills,
			enableAgentPlugins: true,
			agentPlugins,
		},
		cwd: effectiveCwd,
		scenario,
		includeAgentSkills,
		agentMode,
	};
}
