import { join, resolve } from "node:path";
import {
	createNodeForegroundCommandHost,
	type ForegroundCommandExecutorOptions,
	type ForegroundCommandOperations,
} from "@vetta/runtime-node/coding";
import { CONFIG_DIR_NAME, getAgentDir, getSceneDir, getUserSkillsDir } from "../../config.js";
import {
	getDefaultShellCommandPrefix,
	getShellConfig,
	getShellEnv,
} from "../../host/command-execution/shell-runtime.js";

export type RuntimeForegroundCommandOperations = ForegroundCommandOperations;

export interface CodingAgentForegroundCommandHost extends ForegroundCommandExecutorOptions {
	readonly environment: () => NodeJS.ProcessEnv;
}

export function createCodingAgentForegroundCommandHost(cwd: string): CodingAgentForegroundCommandHost {
	const host = createNodeForegroundCommandHost({
		resolveShell: () => {
			const { shell, args } = getShellConfig();
			return { executable: shell, args, commandPrefix: getDefaultShellCommandPrefix(shell) };
		},
		environment: getShellEnv,
		protectedDirectories: [
			resolve(join(getAgentDir(), "skills")),
			resolve(getUserSkillsDir()),
			resolve(getSceneDir()),
			resolve(cwd, CONFIG_DIR_NAME, "skills"),
		],
	});
	return { ...host, environment: getShellEnv };
}
