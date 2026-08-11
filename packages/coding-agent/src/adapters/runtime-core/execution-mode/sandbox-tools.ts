import type { CodingToolRegistration, ForegroundCommandOperations } from "@vetta/runtime-tools/coding";
import { buildLinuxBubblewrapToolRegistrations, type LinuxBubblewrapToolOptions } from "./linux-bwrap-tools.js";
import { buildMacosSeatbeltToolRegistrations, type MacosSeatbeltToolOptions } from "./macos-seatbelt-tools.js";
import type { SandboxRuntimeToolOptions } from "./sandbox-tool-utils.js";
import { buildWindowsSandboxToolRegistrations, type WindowsSandboxToolOptions } from "./windows-sandbox-tools.js";

export interface SandboxToolOptions extends SandboxRuntimeToolOptions {
	readonly platform?: NodeJS.Platform;
	readonly windowsSandboxHostPath?: WindowsSandboxToolOptions["sandboxHostPath"];
	readonly linuxBubblewrapPath?: LinuxBubblewrapToolOptions["bubblewrapPath"];
	readonly macosSandboxExecPath?: MacosSeatbeltToolOptions["sandboxExecPath"];
	/** Test/host injection boundary; production selects the platform implementation. */
	readonly commandOperations?: ForegroundCommandOperations;
}

export function buildSandboxToolRegistrations(
	options: SandboxToolOptions,
): readonly CodingToolRegistration[] | undefined {
	const platform = options.platform ?? process.platform;
	if (platform === "win32") {
		return buildWindowsSandboxToolRegistrations({
			...options,
			sandboxHostPath: options.windowsSandboxHostPath,
		});
	}
	if (platform === "linux") {
		return buildLinuxBubblewrapToolRegistrations({
			...options,
			bubblewrapPath: options.linuxBubblewrapPath,
		});
	}
	if (platform === "darwin") {
		return buildMacosSeatbeltToolRegistrations({
			...options,
			sandboxExecPath: options.macosSandboxExecPath,
		});
	}
	return undefined;
}
