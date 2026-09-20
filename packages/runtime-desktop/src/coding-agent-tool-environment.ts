import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	type CodingAgentSessionExecutionEnvironmentFactory,
	type CodingAgentToolEnvironmentFactory,
	createCodingAgentEditPathPolicy,
	createCodingAgentSessionCommandEnvironment,
	createCodingAgentWritePathPolicy,
} from "@vetta/coding-agent/composition";
import {
	CONFIG_DIR_NAME,
	getAgentDir,
	getKnowledgeDir,
	getSceneDir,
	getUserSkillsDir,
	getVettaHomePath,
} from "@vetta/coding-agent/config";
import { CODING_AGENT_READ_TOOL_OPTIONS } from "@vetta/coding-agent/host";
import { SettingsRuntime } from "@vetta/coding-agent/settings";
import {
	createNodeFileToolRegistrations,
	createNodeHostCodingToolEnvironment,
	createNodeHostSessionCommandEnvironment,
	createNodePathBoundaryClassifier,
	createNodeSandboxCodingToolEnvironment,
	createNodeShellEnvironment,
	getNodeShellCommandPrefix,
	resolveNodeShell,
} from "@vetta/runtime-node/coding";
import { NodeScopedTextStorage } from "@vetta/runtime-node/host";
import { createSshCodingToolEnvironment, createSshPathPolicies } from "@vetta/runtime-ssh";
import { parseProjectLocation } from "@vetta/ssh-transport";
import { resolveProjectSettingsPath } from "./project-settings-path.js";
import { resolveDesktopSshConnection } from "./ssh-connection-resolver.js";

/**
 * Desktop Composition Root selection of Coding Agent's tool implementations.
 *
 * 远程项目（cwd 是 `ssh://<hostId>/<路径>`）换成 SSH 实现，工具逻辑仍是同一份；
 * 传进去的是解析出来的远端绝对路径，而不是 URI——工具内部所有相对路径解析都基于它。
 */
export const createDesktopCodingAgentToolEnvironment: CodingAgentToolEnvironmentFactory = (context) => {
	const location = parseProjectLocation(context.cwd);
	if (location.kind === "ssh") {
		const policies = createSshPathPolicies(location.remotePath);
		return createSshCodingToolEnvironment({
			connection: resolveDesktopSshConnection(location.hostId),
			remoteCwd: location.remotePath,
			editPathPolicy: policies.editPathPolicy,
			writePathPolicy: policies.writePathPolicy,
			readOptions: CODING_AGENT_READ_TOOL_OPTIONS,
			localReadRoots: resolveLocalReadRoots(context.agentDir),
		});
	}
	const host = createDesktopNodeToolHost(context.cwd, context.agentDir);
	return createNodeHostCodingToolEnvironment({
		cwd: context.cwd,
		toolsDirectory: host.toolsDirectory,
		resolveShell: host.resolveShell,
		environment: host.environment,
		protectedDirectories: host.protectedCommandDirectories,
		editPathPolicy: host.editPathPolicy,
		writePathPolicy: host.writePathPolicy,
		configurationSource: context.configurationSource,
		readOptions: CODING_AGENT_READ_TOOL_OPTIONS,
	});
};

/**
 * Desktop Composition Root selection of Session-local command and sandbox implementations.
 *
 * 远程项目没有可用的沙箱：seatbelt 与 bubblewrap 都是本机进程语义，对远端命令不起
 * 任何作用。这里返回与工具环境同一套 SSH 实现并且**不提供** sandbox，宁可让上层在
 * 需要沙箱时失败，也不给出一个名义上开着、实际不设防的沙箱。
 */
export const createDesktopCodingAgentSessionExecutionEnvironment: CodingAgentSessionExecutionEnvironmentFactory = (
	context,
) => {
	const location = parseProjectLocation(context.cwd);
	if (location.kind === "ssh") {
		const policies = createSshPathPolicies(location.remotePath);
		const environment = createSshCodingToolEnvironment({
			connection: resolveDesktopSshConnection(location.hostId),
			remoteCwd: location.remotePath,
			editPathPolicy: policies.editPathPolicy,
			writePathPolicy: policies.writePathPolicy,
			readOptions: CODING_AGENT_READ_TOOL_OPTIONS,
			localReadRoots: resolveLocalReadRoots(context.agentDir),
		});
		return {
			registrations: environment.registrations,
			backgroundService: environment.backgroundService,
			// 返回一个不提供工具集的沙箱，而不是假装沙箱存在：本机的 seatbelt/bubblewrap
			// 对远端命令毫无作用，给出「名义上开着、实际不设防」的沙箱比明确没有更危险。
			sandbox: { createToolSet: () => undefined },
			dispose: () => environment.dispose(),
		};
	}
	const host = createDesktopNodeToolHost(context.cwd, context.agentDir);
	const command = createNodeHostSessionCommandEnvironment({
		cwd: context.cwd,
		resolveShell: host.resolveShell,
		environment: host.environment,
		sessionEnvironment: createCodingAgentSessionCommandEnvironment(context.sessionId, context.env),
		protectedDirectories: host.protectedCommandDirectories,
	});
	return {
		registrations: [
			...createNodeFileToolRegistrations({
				cwd: context.cwd,
				editPathPolicy: host.editPathPolicy,
				writePathPolicy: host.writePathPolicy,
				configurationSource: context.configurationSource,
				readOptions: CODING_AGENT_READ_TOOL_OPTIONS,
			}),
			...command.registrations,
		],
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
					configurationSource: context.configurationSource,
					readOptions: CODING_AGENT_READ_TOOL_OPTIONS,
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
			project: resolveProjectSettingsPath(cwd, agentDir),
		}),
	);
	const protectedCommandDirectories = [
		resolve(agentDir, "skills"),
		resolve(getUserSkillsDir()),
		resolve(getSceneDir()),
		resolve(cwd, CONFIG_DIR_NAME, "skills"),
	];
	const pathClassifier = createNodePathBoundaryClassifier({
		readOnlyDirectories: [
			...protectedCommandDirectories,
			resolve(homedir(), ".agents", "skills"),
			resolve(cwd, ".agents", "skills"),
		],
		managedDirectory: join(getKnowledgeDir(), "wiki"),
	});
	const boundaries = {
		isProtectedSkillOrScenePath: pathClassifier.isReadOnlyPath,
		isKnowledgeWikiPath: pathClassifier.isManagedPath,
	};
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

/**
 * 远程会话里仍要从本机读取的目录：宿主交给模型的本机路径都落在这几处。
 *
 * - Vetta 主目录：粘贴图片的缓存、用户技能、场景、会话产物。
 * - agent 目录：通常在主目录之下，自定义位置时单独列出。
 * - 系统临时目录：被截断的命令输出的完整日志、远端后台任务的本地日志。
 * - 应用资源目录：随应用分发的预设插件技能。
 */
function resolveLocalReadRoots(configuredAgentDir: string | undefined): readonly string[] {
	const roots = [
		getVettaHomePath(),
		configuredAgentDir ?? getAgentDir(),
		getUserSkillsDir(),
		getSceneDir(),
		tmpdir(),
		// Electron 主进程才有；CLI 与测试里是 undefined。
		(process as NodeJS.Process & { resourcesPath?: string }).resourcesPath,
	];
	return roots.filter((root): root is string => typeof root === "string" && root.length > 0);
}
