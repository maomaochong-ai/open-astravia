import type { ConversationScenario } from "@astravia/coding-agent";
import { ASTRAVIA_CLI_GUIDANCE } from "../../../../coding-agent/src/core/system-prompt.js";
import type { SessionConfig } from "../../../../runtime-core/src/index.js";
import { buildDatabaseSchemaPrompt, databaseSchemaContextIo } from "../database/schema-context-injection.js";
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
		isConversation && desktopConfig.experimental?.astraviaCli === true
			? config?.appendSystemPrompt
				? `${config.appendSystemPrompt}\n\n${ASTRAVIA_CLI_GUIDANCE}`
				: ASTRAVIA_CLI_GUIDANCE
			: config?.appendSystemPrompt;
	// B2.5/B2.10：AI 数据库感知——conversation 场景且感知开关开启时，把已配置连接的 schema 摘要
	// 追加到 appendSystemPrompt（失败静默，不阻塞会话创建）。
	// B2.10-W2 权限分离：感知开关只管注入；AI 访问由 database.dbxToolEnabled → mcp.json dbx.disabled
	// 控制（关闭即 dbx 工具不注册，AI 无法执行 SQL），见 main/ipc/fs.ts syncDbxToolAccessGate。
	const database = desktopConfig.database;
	const dbxToolEnabled = database?.dbxToolEnabled === true;
	const schemaPrompt =
		isConversation && database?.schemaInjection === true
			? await buildDatabaseSchemaPrompt(databaseSchemaContextIo, {
					executeToolAvailable: dbxToolEnabled,
					// B2.10-W4-① 感知范围：缺省 all（全部连接全表）；undefined 由注入层按 all 处理。
					scope: database?.schemaInjectionScope,
					// B3.1-①-C 连接级 AI 访问白名单 + 环境映射：在 schema 注入阶段就排除 AI 不可访问的连接。
					connectionAiAccess: database?.connectionAiAccess,
					connectionEnv: database?.connectionEnv,
				})
			: undefined;
	// B2.10-W2：AI 访问未开启（缺省）时，若未注入 schema 块，补一条简短提示，避免模型臆造 dbx 工具名
	// 触发 “Tool dbx_execute_query not found”。schema 注入场景由 schema 块内的不可用说明覆盖，不重复追加。
	const dbxToolDisabledHint =
		isConversation && !dbxToolEnabled && desktopConfig.database?.schemaInjection !== true
			? "注意：数据库 AI 访问未开启（工作台「数据库」页的「AI 访问」开关关闭），dbx MCP 工具（dbx_execute_query 等）不可用；不要调用 dbx_* 工具。若用户请求查询数据库或执行 SQL，请说明需先在工作台开启「AI 访问」。"
			: undefined;
	const combinedAppend = [appendSystemPrompt, schemaPrompt, dbxToolDisabledHint]
		.filter((part) => part?.trim())
		.join("\n\n");
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
			appendSystemPrompt: combinedAppend || undefined,
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
