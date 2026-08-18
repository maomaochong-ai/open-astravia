/** Coding Agent launch arguments shared by CLI bootstrap and Extension flag discovery. */

import type { ThinkingLevel } from "@vetta/agent-core";
import {
	CODING_AGENT_BUILT_IN_TOOL_NAMES,
	type CodingAgentBuiltInToolName,
	isCodingAgentBuiltInToolName,
} from "../composition/coding-agent-built-in-tool-names.js";
import { isValidThinkingLevel, VALID_THINKING_LEVELS } from "../models/index.js";
import type { ConversationScenario } from "../profiles/index.js";

export { isValidThinkingLevel };

export type Mode = "text" | "json" | "rpc";

export interface Args {
	provider?: string;
	model?: string;
	apiKey?: string;
	systemPrompt?: string;
	appendSystemPrompt?: string;
	thinking?: ThinkingLevel;
	continue?: boolean;
	resume?: boolean;
	help?: boolean;
	version?: boolean;
	mode?: Mode;
	noSession?: boolean;
	session?: string;
	sessionDir?: string;
	models?: string[];
	tools?: CodingAgentBuiltInToolName[];
	noTools?: boolean;
	extensions?: string[];
	noExtensions?: boolean;
	print?: boolean;
	export?: string;
	noSkills?: boolean;
	skills?: string[];
	promptTemplates?: string[];
	noPromptTemplates?: boolean;
	themes?: string[];
	noThemes?: boolean;
	listModels?: string | true;
	offline?: boolean;
	verbose?: boolean;
	/**
	 * Enable the host-bridge channel in rpc mode. Registers the `im_send_attachment`
	 * tool and lets it issue `host_request` events that the host (im-gateway)
	 * answers via `host_response` commands. Only meaningful with `--mode rpc`.
	 * See docs/rpc.md and RpcHostRequest in rpc/rpc-types.ts.
	 */
	enableHostBridge?: boolean;
	/**
	 * Enable memory-mode (ADR-0009): MEMORY.md cross-session memory injected as a
	 * frozen system-prompt snapshot, the `memory` tool, session rollover replacing
	 * the LLM compaction layer, and the dated work log. Only meaningful with
	 * `--mode rpc`; im-gateway sets it for the Claw conversation cwd.
	 */
	memoryMode?: boolean;
	/** Absolute path to MEMORY.md (run-cwd-independent). Defaults to <cwd>/MEMORY.md. */
	memoryFile?: string;
	/**
	 * 对话场景 slug（决定按 scope_use 激活哪些工具）。im-gateway 子进程传 "im-claw"；
	 * 不传则 SDK 用 DEFAULT_SCENARIO("cli")。
	 */
	scenario?: ConversationScenario;
	messages: string[];
	fileArgs: string[];
	/** Unknown flags (potentially extension flags) - map of flag name to value */
	unknownFlags: Map<string, boolean | string>;
}

export interface ParseCodingAgentLaunchArgumentsOptions {
	readonly extensionFlags?: ReadonlyMap<string, { readonly type: "boolean" | "string" }>;
	readonly onWarning?: (warning: string) => void;
}

/** Parse the launch contract without performing terminal I/O. */
export function parseArgs(args: string[], options: ParseCodingAgentLaunchArgumentsOptions = {}): Args {
	const result: Args = {
		messages: [],
		fileArgs: [],
		unknownFlags: new Map(),
	};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];

		if (arg === "--help" || arg === "-h") {
			result.help = true;
		} else if (arg === "--version" || arg === "-v") {
			result.version = true;
		} else if (arg === "--mode" && i + 1 < args.length) {
			const mode = args[++i];
			if (mode === "text" || mode === "json" || mode === "rpc") {
				result.mode = mode;
			}
		} else if (arg === "--continue" || arg === "-c") {
			result.continue = true;
		} else if (arg === "--resume" || arg === "-r") {
			result.resume = true;
		} else if (arg === "--provider" && i + 1 < args.length) {
			result.provider = args[++i];
		} else if (arg === "--model" && i + 1 < args.length) {
			result.model = args[++i];
		} else if (arg === "--api-key" && i + 1 < args.length) {
			result.apiKey = args[++i];
		} else if (arg === "--system-prompt" && i + 1 < args.length) {
			result.systemPrompt = args[++i];
		} else if (arg === "--append-system-prompt" && i + 1 < args.length) {
			result.appendSystemPrompt = args[++i];
		} else if (arg === "--no-session") {
			result.noSession = true;
		} else if (arg === "--session" && i + 1 < args.length) {
			result.session = args[++i];
		} else if (arg === "--session-dir" && i + 1 < args.length) {
			result.sessionDir = args[++i];
		} else if (arg === "--models" && i + 1 < args.length) {
			result.models = args[++i].split(",").map((s) => s.trim());
		} else if (arg === "--no-tools") {
			result.noTools = true;
		} else if (arg === "--tools" && i + 1 < args.length) {
			const toolNames = args[++i].split(",").map((s) => s.trim());
			const validTools: CodingAgentBuiltInToolName[] = [];
			for (const name of toolNames) {
				if (isCodingAgentBuiltInToolName(name)) {
					validTools.push(name);
				} else {
					options.onWarning?.(
						`Unknown tool "${name}". Valid tools: ${CODING_AGENT_BUILT_IN_TOOL_NAMES.join(", ")}`,
					);
				}
			}
			result.tools = validTools;
		} else if (arg === "--thinking" && i + 1 < args.length) {
			const level = args[++i];
			if (isValidThinkingLevel(level)) {
				result.thinking = level;
			} else {
				options.onWarning?.(`Invalid thinking level "${level}". Valid values: ${VALID_THINKING_LEVELS.join(", ")}`);
			}
		} else if (arg === "--print" || arg === "-p") {
			result.print = true;
		} else if (arg === "--export" && i + 1 < args.length) {
			result.export = args[++i];
		} else if ((arg === "--extension" || arg === "-e") && i + 1 < args.length) {
			result.extensions = result.extensions ?? [];
			result.extensions.push(args[++i]);
		} else if (arg === "--no-extensions" || arg === "-ne") {
			result.noExtensions = true;
		} else if (arg === "--skill" && i + 1 < args.length) {
			result.skills = result.skills ?? [];
			result.skills.push(args[++i]);
		} else if (arg === "--prompt-template" && i + 1 < args.length) {
			result.promptTemplates = result.promptTemplates ?? [];
			result.promptTemplates.push(args[++i]);
		} else if (arg === "--theme" && i + 1 < args.length) {
			result.themes = result.themes ?? [];
			result.themes.push(args[++i]);
		} else if (arg === "--no-skills" || arg === "-ns") {
			result.noSkills = true;
		} else if (arg === "--no-prompt-templates" || arg === "-np") {
			result.noPromptTemplates = true;
		} else if (arg === "--no-themes") {
			result.noThemes = true;
		} else if (arg === "--list-models") {
			// Check if next arg is a search pattern (not a flag or file arg)
			if (i + 1 < args.length && !args[i + 1].startsWith("-") && !args[i + 1].startsWith("@")) {
				result.listModels = args[++i];
			} else {
				result.listModels = true;
			}
		} else if (arg === "--verbose") {
			result.verbose = true;
		} else if (arg === "--enable-host-bridge") {
			result.enableHostBridge = true;
		} else if (arg === "--memory-mode") {
			result.memoryMode = true;
		} else if (arg === "--memory-file" && i + 1 < args.length) {
			result.memoryFile = args[++i];
		} else if (arg === "--scenario" && i + 1 < args.length) {
			result.scenario = args[++i] as ConversationScenario;
		} else if (arg === "--offline") {
			result.offline = true;
		} else if (arg.startsWith("@")) {
			result.fileArgs.push(arg.slice(1)); // Remove @ prefix
		} else if (arg.startsWith("--") && options.extensionFlags) {
			// Check if it's an extension-registered flag
			const flagName = arg.slice(2);
			const extFlag = options.extensionFlags.get(flagName);
			if (extFlag) {
				if (extFlag.type === "boolean") {
					result.unknownFlags.set(flagName, true);
				} else if (extFlag.type === "string" && i + 1 < args.length) {
					result.unknownFlags.set(flagName, args[++i]);
				}
			}
			// Unknown flags without extension metadata are silently ignored during the discovery pass.
		} else if (!arg.startsWith("-")) {
			result.messages.push(arg);
		}
	}

	return result;
}
