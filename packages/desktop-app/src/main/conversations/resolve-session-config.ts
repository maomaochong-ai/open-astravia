import { VETTA_CLI_GUIDANCE } from "@vetta/coding-agent/product-prompt";
import type { ConversationScenario } from "@vetta/coding-agent/profile";
import type { SessionConfig } from "@vetta/runtime-core";
import { allowProjectRoot, readDesktopConfig } from "../ipc/fs.js";
import { getAppLogger } from "../logger.js";
import {
	buildAgentPluginRuntimeConfig,
	setPluginRuntimeAgentMode,
	summarizeAgentPluginRuntimeConfig,
} from "../plugins/plugin-store.js";
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
	// 让插件级 agent_mode 硬闸的当前模式与本会话一致（纯全局态，见 ADR-0046）。
	setPluginRuntimeAgentMode(desktopConfig.agentMode ?? "work");
	const agentPlugins = buildAgentPluginRuntimeConfig();
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
			agentMode: desktopConfig.agentMode ?? "work",
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
	};
}
