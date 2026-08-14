import type { CodingToolRegistration, CodingToolScope } from "../../tool-registration.js";
import { createShellTool, type ShellToolInput, type ShellToolOptions } from "./shell-tool.js";

const ALL_SHELL_SCOPES = [
	"im-claw",
	"conversation",
	"project",
	"batch",
	"automation",
	"kb-processing",
	"cli",
] as const satisfies readonly CodingToolScope[];

export const SHELL_TOOL_CATEGORY = "core" as const;

export function getShellToolScopes(platform: NodeJS.Platform = process.platform): readonly CodingToolScope[] {
	return platform === "win32" ? ALL_SHELL_SCOPES : [];
}

export interface ShellToolRegistrationOptions extends ShellToolOptions {
	readonly platform?: NodeJS.Platform;
}

export function createShellToolRegistration(
	cwd: string,
	options: ShellToolRegistrationOptions,
): CodingToolRegistration<ShellToolInput> {
	return {
		tool: createShellTool(cwd, options),
		scopeUse: getShellToolScopes(options.platform),
		category: SHELL_TOOL_CATEGORY,
		// 命令执行的边界由 Execution Mode（沙盒/全访问）承担，首调确认对任意命令流无防护价值。
		sideEffect: "light",
	};
}
