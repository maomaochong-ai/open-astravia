import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
	type CodingAgentSessionExecutionEnvironmentFactory,
	type CodingAgentToolEnvironmentFactory,
	createCodingAgentEditPathPolicy,
	createCodingAgentWritePathPolicy,
} from "@vetta/coding-agent/composition";
import {
	CONFIG_DIR_NAME,
	getAgentDir,
	getKnowledgeDir,
	getSceneDir,
	getUserSkillsDir,
} from "@vetta/coding-agent/config";
import { SettingsRuntime } from "@vetta/coding-agent/settings";
import {
	createNodeHostCodingToolEnvironment,
	createNodeHostSessionCommandEnvironment,
	createNodePathBoundaryClassifier,
	createNodeSandboxCodingToolEnvironment,
	createNodeShellEnvironment,
	getNodeShellCommandPrefix,
	resolveNodeShell,
} from "@vetta/runtime-node/coding";
import { NodeScopedTextStorage } from "@vetta/runtime-node/host";

/** Desktop Composition Root selection of Coding Agent's Node tool implementations. */
export const createDesktopCodingAgentToolEnvironment: CodingAgentToolEnvironmentFactory = (context) => {
	const host = createDesktopNodeToolHost(context.cwd, context.agentDir);
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

/** Desktop Composition Root selection of Session-local command and sandbox implementations. */
export const createDesktopCodingAgentSessionExecutionEnvironment: CodingAgentSessionExecutionEnvironmentFactory = (
	context,
) => {
	const host = createDesktopNodeToolHost(context.cwd, context.agentDir);
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
			createToolSet: (options) =>
				createNodeSandboxCodingToolEnvironment({
					...options,
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

function createDesktopNodeToolHost(cwd: string, configuredAgentDir?: string) {
	const agentDir = configuredAgentDir ?? getAgentDir();
	const settingsPath = join(agentDir, "settings.json");
	const toolsDirectory = join(agentDir, "bin");
	const settings = SettingsRuntime.fromStorage(
		new NodeScopedTextStorage({
			global: settingsPath,
			project: join(cwd, CONFIG_DIR_NAME, "settings.json"),
		}),
	);
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
		const shell = resolveNodeShell({ customShellPath: settings.getShellPath(), settingsPath });
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
