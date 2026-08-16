import {
	createNodeShellEnvironment,
	getNodeShellCommandPrefix,
	isWindowsPowerShellShell,
	prependCommandPrefixes,
	resolveNodeShell,
	WINDOWS_POWERSHELL_UTF8_COMMAND_PREFIX,
} from "@vetta/runtime-node/coding";
import { getBinDir, getSettingsPath } from "../../config.js";
import { createCodingAgentNodeSettingsRuntime } from "../node-state-services.js";

export interface ShellCommand {
	readonly shell: string;
	readonly args: string[];
}

let cachedShellCommand: ShellCommand | undefined;

export { isWindowsPowerShellShell, prependCommandPrefixes, WINDOWS_POWERSHELL_UTF8_COMMAND_PREFIX };

export function getDefaultShellCommandPrefix(shellPath: string): string | undefined {
	return getNodeShellCommandPrefix(shellPath);
}

/** Compatibility adapter until Settings and host directories become injected ports. */
export function getShellConfig(): ShellCommand {
	if (cachedShellCommand) return cachedShellCommand;
	const resolved = resolveNodeShell({
		customShellPath: createCodingAgentNodeSettingsRuntime().getShellPath(),
		settingsPath: getSettingsPath(),
	});
	cachedShellCommand = { shell: resolved.executable, args: [...resolved.args] };
	return cachedShellCommand;
}

export function getShellEnv(): NodeJS.ProcessEnv {
	return createNodeShellEnvironment(getBinDir());
}
