import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
	type CodingAgentSessionExecutionEnvironmentFactory,
	type CodingAgentToolEnvironmentFactory,
	createCodingAgentEditPathPolicy,
	createCodingAgentWritePathPolicy,
} from "@vetta/coding-agent/composition";
import { CONFIG_DIR_NAME, getKnowledgeDir, getSceneDir, getUserSkillsDir } from "@vetta/coding-agent/config";
import type { SettingsRuntime } from "@vetta/coding-agent/settings";
import {
	createNodeHostCodingToolEnvironment,
	createNodeHostSessionCommandEnvironment,
	createNodePathBoundaryClassifier,
	createNodeSandboxCodingToolEnvironment,
	createNodeShellEnvironment,
	getNodeShellCommandPrefix,
	resolveNodeShell,
} from "@vetta/runtime-node/coding";

export interface CliCodingAgentToolEnvironmentOptions {
	readonly agentDir: string;
	readonly settings: SettingsRuntime;
}

/** CLI Composition Root selection of Coding Agent's Node tool implementations. */
export function createCliCodingAgentToolEnvironmentFactory(
	options: CliCodingAgentToolEnvironmentOptions,
): CodingAgentToolEnvironmentFactory {
	return (context) => {
		const host = createCliNodeToolHost(context.cwd, context.agentDir, options);
		return createNodeHostCodingToolEnvironment({
			cwd: context.cwd,
			toolsDirectory: host.toolsDirectory,
			resolveShell: host.resolveShell,
			environment: host.environment,
			protectedDirectories: host.protectedCommandDirectories,
			editPathPolicy: host.editPathPolicy,
			writePathPolicy: host.writePathPolicy,
		});
	};
}

/** CLI Composition Root selection of Session-local command and sandbox implementations. */
export function createCliCodingAgentSessionExecutionEnvironmentFactory(
	options: CliCodingAgentToolEnvironmentOptions,
): CodingAgentSessionExecutionEnvironmentFactory {
	return (context) => {
		const host = createCliNodeToolHost(context.cwd, context.agentDir, options);
		const command = createNodeHostSessionCommandEnvironment({
			cwd: context.cwd,
			resolveShell: host.resolveShell,
			environment: host.environment,
			sessionEnvironment: context.env,
			protectedDirectories: host.protectedCommandDirectories,
		});
		return {
			registrations: command.registrations,
			backgroundService: command.backgroundService,
			sandbox: {
				createToolSet: (sandboxOptions) =>
					createNodeSandboxCodingToolEnvironment({
						...sandboxOptions,
						cwd: context.cwd,
						resolveShell: host.resolveShell,
						environment: command.commandEnvironment,
						protectedDirectories: host.protectedCommandDirectories,
						editPathPolicy: host.editPathPolicy,
						writePathPolicy: host.writePathPolicy,
					}),
			},
			dispose: () => command.dispose(),
		};
	};
}

function createCliNodeToolHost(
	cwd: string,
	configuredAgentDir: string | undefined,
	options: CliCodingAgentToolEnvironmentOptions,
) {
	const agentDir = configuredAgentDir ?? options.agentDir;
	const settingsPath = join(agentDir, "settings.json");
	const toolsDirectory = join(agentDir, "bin");
	const protectedCommandDirectories = [
		resolve(agentDir, "skills"),
		resolve(getUserSkillsDir()),
		resolve(getSceneDir()),
		resolve(cwd, CONFIG_DIR_NAME, "skills"),
	];
	const boundaries = createNodePathBoundaryClassifier({
		protectedDirectories: [
			...protectedCommandDirectories,
			resolve(homedir(), ".agents", "skills"),
			resolve(cwd, ".agents", "skills"),
		],
		knowledgeWikiDirectory: join(getKnowledgeDir(), "wiki"),
	});
	const resolveShell = () => {
		const shell = resolveNodeShell({ customShellPath: options.settings.getShellPath(), settingsPath });
		return { ...shell, commandPrefix: getNodeShellCommandPrefix(shell.executable) };
	};

	return {
		toolsDirectory,
		resolveShell,
		environment: () => createNodeShellEnvironment(toolsDirectory),
		protectedCommandDirectories,
		editPathPolicy: createCodingAgentEditPathPolicy(boundaries),
		writePathPolicy: createCodingAgentWritePathPolicy(boundaries),
	};
}
