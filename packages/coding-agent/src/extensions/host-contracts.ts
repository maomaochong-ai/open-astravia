import type { ExtensionFactory } from "./api-contracts.js";
import type { ExecOptions, ExecResult } from "./infrastructure.js";

export type ExtensionModuleProfile = "native" | "pi";

/** Host-owned execution of an Extension module. */
export interface ExtensionFactoryLoader {
	loadFactory(
		extensionPath: string,
		profile: ExtensionModuleProfile,
		options?: { readonly signal?: AbortSignal },
	): Promise<ExtensionFactory | undefined>;
}

/** Host-owned process execution exposed through ExtensionAPI.exec(). */
export interface ExtensionCommandExecutor {
	execute(command: string, args: readonly string[], cwd: string, options?: ExecOptions): Promise<ExecResult>;
}
