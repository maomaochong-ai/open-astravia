import { createNodeSandboxHost } from "@vetta/runtime-node/sandbox";
import type { CodingToolRegistration, ForegroundCommandOperations } from "@vetta/runtime-tools";
import { getShellConfig } from "../../../host/command-execution/shell-runtime.js";
import type { SandboxCommandPlatform, SandboxHostServices } from "./sandbox-host-services.js";
import { createSandboxToolRegistrations, type SandboxRuntimeToolOptions } from "./sandbox-tool-utils.js";

export interface SandboxToolOptions extends Omit<SandboxRuntimeToolOptions, "hostServices"> {
	readonly platform?: SandboxCommandPlatform;
	readonly windowsSandboxHostPath?: string;
	readonly linuxBubblewrapPath?: string;
	readonly macosSandboxExecPath?: string;
	readonly hostServices?: SandboxHostServices;
	/** Test/host injection boundary; production selects the platform implementation. */
	readonly commandOperations?: ForegroundCommandOperations;
}

export function buildSandboxToolRegistrations(
	options: SandboxToolOptions,
): readonly CodingToolRegistration[] | undefined {
	const hostServices =
		options.hostServices ??
		createNodeSandboxHost({
			platform: options.platform,
			windowsSandboxHostPath: options.windowsSandboxHostPath,
			linuxBubblewrapPath: options.linuxBubblewrapPath,
			macosSandboxExecPath: options.macosSandboxExecPath,
			commandOperations: options.commandOperations,
			resolveShell: () => {
				const { shell, args } = getShellConfig();
				return { executable: shell, args };
			},
		});
	if (!hostServices) return undefined;
	return createSandboxToolRegistrations({ ...options, hostServices });
}
