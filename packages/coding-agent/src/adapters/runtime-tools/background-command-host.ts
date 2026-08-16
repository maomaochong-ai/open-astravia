import {
	type BackgroundCommandHost,
	type BackgroundCommandOutput,
	type BackgroundCommandOutputStore,
	type BackgroundCommandProcess,
	type BackgroundCommandProcessOperations,
	createNodeBackgroundCommandHost,
	type SpawnBackgroundCommandProcessOptions,
	sanitizeBinaryOutput,
} from "@vetta/runtime-node/coding";
import stripAnsi from "strip-ansi";
import { getDefaultShellCommandPrefix, getShellConfig } from "../../host/command-execution/shell-runtime.js";

export type RuntimeBackgroundCommandProcess = BackgroundCommandProcess;
export type RuntimeSpawnBackgroundCommandProcessOptions = SpawnBackgroundCommandProcessOptions;
export type RuntimeBackgroundCommandProcessOperations = BackgroundCommandProcessOperations;
export type RuntimeBackgroundCommandOutput = BackgroundCommandOutput;
export type RuntimeBackgroundCommandOutputStore = BackgroundCommandOutputStore;
export type CodingAgentBackgroundCommandHost = BackgroundCommandHost;

export function createCodingAgentBackgroundCommandHost(): CodingAgentBackgroundCommandHost {
	return createNodeBackgroundCommandHost({
		resolveShell: () => {
			const { shell, args } = getShellConfig();
			return { executable: shell, args, commandPrefix: getDefaultShellCommandPrefix(shell) };
		},
		normalizeOutput: (value) => sanitizeBinaryOutput(stripAnsi(value)),
	});
}
