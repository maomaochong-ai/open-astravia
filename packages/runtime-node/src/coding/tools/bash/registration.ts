import type { CodingToolRegistration, CodingToolScope } from "../../tool-registration.js";
import { type BashToolInput, type BashToolOptions, createBashTool } from "./bash-tool.js";

const ALL_BASH_SCOPES = [
	"im-claw",
	"conversation",
	"project",
	"batch",
	"automation",
	"kb-processing",
	"cli",
] as const satisfies readonly CodingToolScope[];

export const BASH_TOOL_CATEGORY = "core" as const;

export function getBashToolScopes(platform: NodeJS.Platform = process.platform): readonly CodingToolScope[] {
	return platform === "win32" ? [] : ALL_BASH_SCOPES;
}

export interface BashToolRegistrationOptions extends BashToolOptions {
	readonly platform?: NodeJS.Platform;
}

export function createBashToolRegistration(
	cwd: string,
	options: BashToolRegistrationOptions,
): CodingToolRegistration<BashToolInput> {
	return {
		tool: createBashTool(cwd, options),
		scopeUse: getBashToolScopes(options.platform),
		category: BASH_TOOL_CATEGORY,
		// 命令执行的边界由 Execution Mode（沙盒/全访问）承担，首调确认对任意命令流无防护价值。
		sideEffect: "light",
	};
}
