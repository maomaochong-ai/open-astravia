import { join } from "node:path";
import {
	type CodingAgentBootstrap,
	type CodingAgentBootstrapDiagnostics,
	createCodingAgentBootstrap,
} from "@vetta/coding-agent/bootstrap";
import { ENV_SERVER_URL, getAgentDir } from "@vetta/coding-agent/config";
import { runCodingAgentStartupMigrations } from "@vetta/coding-agent/historical-sessions";
import { createCodingAgentAuthRuntime, createCodingAgentModelRuntime } from "@vetta/coding-agent/host-services";
import { NodeTransactionalTextStorage } from "@vetta/runtime-node/host";
import chalk from "chalk";
import { createCliSessionResourceRuntime, createCliSettingsRuntime } from "./coding-agent-resource-runtime.js";

export interface CreateCliCodingAgentBootstrapOptions extends CodingAgentBootstrapDiagnostics {
	readonly args: string[];
	readonly cwd?: string;
	readonly agentDir?: string;
}

/** Select the concrete Node state and resource implementations used by the CLI host. */
export async function createCliCodingAgentBootstrap(
	options: CreateCliCodingAgentBootstrapOptions,
): Promise<CodingAgentBootstrap> {
	applyOfflineMode(options.args);
	const cwd = options.cwd ?? process.cwd();
	const agentDir = options.agentDir ?? getAgentDir();
	runCodingAgentStartupMigrations({ cwd, agentDir });

	const settingsManager = createCliSettingsRuntime(cwd, agentDir);
	const authStorage = createCodingAgentAuthRuntime(new NodeTransactionalTextStorage(join(agentDir, "auth.json")));
	const modelRegistry = createCodingAgentModelRuntime(authStorage, {
		modelsJsonPath: join(agentDir, "models.json"),
	});

	return createCodingAgentBootstrap({
		args: options.args,
		cwd,
		agentDir,
		settingsManager,
		authStorage,
		modelRegistry,
		serverUrlOverride: process.env[ENV_SERVER_URL],
		createResourceRuntime: ({ parsed, settings }) =>
			createCliSessionResourceRuntime({
				cwd,
				agentDir,
				settings,
				additionalExtensionPaths: parsed.extensions,
				additionalSkillPaths: parsed.skills,
				additionalPromptTemplatePaths: parsed.promptTemplates,
				additionalThemePaths: parsed.themes,
				noExtensions: parsed.noExtensions,
				noSkills: parsed.noSkills,
				noPromptTemplates: parsed.noPromptTemplates,
				noThemes: parsed.noThemes,
				systemPrompt: parsed.systemPrompt,
				appendSystemPrompt: parsed.appendSystemPrompt,
			}),
		onSettingsError: options.onSettingsError ?? reportSettingsError,
		onExtensionError: options.onExtensionError ?? reportExtensionError,
	});
}

function applyOfflineMode(args: readonly string[]): void {
	if (!args.includes("--offline")) return;
	process.env.PI_OFFLINE = "1";
	process.env.PI_SKIP_VERSION_CHECK = "1";
}

function reportSettingsError({
	scope,
	error,
}: Parameters<NonNullable<CodingAgentBootstrapDiagnostics["onSettingsError"]>>[0]): void {
	console.error(chalk.yellow(`Warning (startup, ${scope} settings): ${error.message}`));
	if (error.stack) console.error(chalk.dim(error.stack));
}

function reportExtensionError({
	path,
	error,
}: Parameters<NonNullable<CodingAgentBootstrapDiagnostics["onExtensionError"]>>[0]): void {
	console.error(chalk.red(`Failed to load extension "${path}": ${error}`));
}
