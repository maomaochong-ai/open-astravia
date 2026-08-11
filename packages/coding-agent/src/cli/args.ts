/**
 * CLI argument parsing and help display
 */

import type { ThinkingLevel } from "@vetta/agent-core";
import chalk from "chalk";
import {
	CODING_AGENT_BUILT_IN_TOOL_NAMES,
	type CodingAgentBuiltInToolName,
	isCodingAgentBuiltInToolName,
} from "../composition/coding-agent-built-in-tool-names.js";
import { APP_NAME, CONFIG_DIR_NAME, ENV_AGENT_DIR, ENV_PACKAGE_DIR, ENV_SHARE_VIEWER_URL } from "../config.js";
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
	 * See docs/rpc.md and RpcHostRequest in modes/rpc/rpc-types.ts.
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

export function parseArgs(args: string[], extensionFlags?: Map<string, { type: "boolean" | "string" }>): Args {
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
					console.error(
						chalk.yellow(
							`Warning: Unknown tool "${name}". Valid tools: ${CODING_AGENT_BUILT_IN_TOOL_NAMES.join(", ")}`,
						),
					);
				}
			}
			result.tools = validTools;
		} else if (arg === "--thinking" && i + 1 < args.length) {
			const level = args[++i];
			if (isValidThinkingLevel(level)) {
				result.thinking = level;
			} else {
				console.error(
					chalk.yellow(
						`Warning: Invalid thinking level "${level}". Valid values: ${VALID_THINKING_LEVELS.join(", ")}`,
					),
				);
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
		} else if (arg.startsWith("--") && extensionFlags) {
			// Check if it's an extension-registered flag
			const flagName = arg.slice(2);
			const extFlag = extensionFlags.get(flagName);
			if (extFlag) {
				if (extFlag.type === "boolean") {
					result.unknownFlags.set(flagName, true);
				} else if (extFlag.type === "string" && i + 1 < args.length) {
					result.unknownFlags.set(flagName, args[++i]);
				}
			}
			// Unknown flags without extensionFlags are silently ignored (first pass)
		} else if (!arg.startsWith("-")) {
			result.messages.push(arg);
		}
	}

	return result;
}

export function printHelp(): void {
	const defaultCommandTool = process.platform === "win32" ? "shell" : "bash";
	const defaultToolsList = `read,${defaultCommandTool},edit,write,grep,glob,dir_tree,doc_to_pdf,html_to_pdf,extract_text_from_pdf,extract_text_from_img,render_pdf_page,current_time`;
	console.log(`${chalk.bold(APP_NAME)} - AI coding assistant with ${defaultToolsList} tools

${chalk.bold("Usage:")}
  ${APP_NAME} [options] [@files...] [messages...]

${chalk.bold("Commands:")}
  ${APP_NAME} install <source> [-l]    Install extension source and add to settings
  ${APP_NAME} remove <source> [-l]     Remove extension source from settings
  ${APP_NAME} update [source]          Update installed extensions (skips pinned sources)
  ${APP_NAME} list                     List installed extensions from settings
  ${APP_NAME} config                   Open TUI to enable/disable package resources
  ${APP_NAME} <command> --help         Show help for install/remove/update/list

${chalk.bold("Options:")}
  --provider <name>              Provider name (default: google)
  --model <pattern>              Model pattern or ID (supports "provider/id" and optional ":<thinking>")
  --api-key <key>                API key (defaults to env vars)
  --system-prompt <text>         System prompt (default: coding assistant prompt)
  --append-system-prompt <text>  Append text or file contents to the system prompt
  --mode <mode>                  Output mode: text (default), json, or rpc
  --print, -p                    Non-interactive mode: process prompt and exit
  --continue, -c                 Continue previous session
  --resume, -r                   Unsupported; use --continue or --session
  --session <path>               Use specific session file
  --session-dir <dir>            Directory for session storage and lookup
  --no-session                   Don't save session (ephemeral)
  --models <patterns>            Comma-separated model patterns for Ctrl+P cycling
                                 Supports globs (anthropic/*, *sonnet*) and fuzzy matching
  --no-tools                     Disable all built-in tools
  --tools <tools>                Comma-separated list of tools to enable (default: ${defaultToolsList})
                                 Available: ${CODING_AGENT_BUILT_IN_TOOL_NAMES.join(", ")}
  --thinking <level>             Set thinking level: off, minimal, low, medium, high, xhigh
  --extension, -e <path>         Load an extension file (can be used multiple times)
  --no-extensions, -ne           Disable extension discovery (explicit -e paths still work)
  --skill <path>                 Load a skill file or directory (can be used multiple times)
  --no-skills, -ns               Disable skills discovery and loading
  --prompt-template <path>       Load a prompt template file or directory (can be used multiple times)
  --no-prompt-templates, -np     Disable prompt template discovery and loading
  --theme <path>                 Load a theme file or directory (can be used multiple times)
  --no-themes                    Disable theme discovery and loading
  --export <file>                Export session file to HTML and exit
  --list-models [search]         List available models (with optional fuzzy search)
  --verbose                      Force verbose startup (overrides quietStartup setting)
  --enable-host-bridge           (--mode rpc only) Register im_send_attachment and host_request RPC channel
  --memory-mode                  (--mode rpc only) Enable MEMORY.md cross-session memory, memory tool, session rollover, dated work log (ADR-0009)
  --memory-file <path>           Absolute path to MEMORY.md (default: <cwd>/MEMORY.md). Implies --memory-mode is honored only when set
  --offline                      Disable startup network operations (same as PI_OFFLINE=1)
  --help, -h                     Show this help
  --version, -v                  Show version number

Extensions can register additional flags (e.g., --plan from plan-mode extension).

${chalk.bold("Examples:")}
  # Interactive mode
  ${APP_NAME}

  # Interactive mode with initial prompt
  ${APP_NAME} "List all .ts files in src/"

  # Include files in initial message
  ${APP_NAME} @prompt.md @image.png "What color is the sky?"

  # Non-interactive mode (process and exit)
  ${APP_NAME} -p "List all .ts files in src/"

  # Multiple messages (interactive)
  ${APP_NAME} "Read package.json" "What dependencies do we have?"

  # Continue previous session
  ${APP_NAME} --continue "What did we discuss?"

  # Use different model
  ${APP_NAME} --provider openai --model gpt-4o-mini "Help me refactor this code"

  # Use model with provider prefix (no --provider needed)
  ${APP_NAME} --model openai/gpt-4o "Help me refactor this code"

  # Use model with thinking level shorthand
  ${APP_NAME} --model sonnet:high "Solve this complex problem"

  # Limit model cycling to specific models
  ${APP_NAME} --models claude-sonnet,claude-haiku,gpt-4o

  # Limit to a specific provider with glob pattern
  ${APP_NAME} --models "github-copilot/*"

  # Cycle models with fixed thinking levels
  ${APP_NAME} --models sonnet:high,haiku:low

  # Start with a specific thinking level
  ${APP_NAME} --thinking high "Solve this complex problem"

  # Read-only mode (no file modifications possible)
  ${APP_NAME} --tools read,grep,glob,find,ls,dir_tree -p "Review the code in src/"

  # Export a session file to HTML
  ${APP_NAME} --export ~/${CONFIG_DIR_NAME}/agent/sessions/--path--/session.jsonl
  ${APP_NAME} --export session.jsonl output.html

${chalk.bold("Environment Variables:")}
  ANTHROPIC_API_KEY                - Anthropic Claude API key
  ANTHROPIC_OAUTH_TOKEN            - Anthropic OAuth token (alternative to API key)
  OPENAI_API_KEY                   - OpenAI GPT API key
  AZURE_OPENAI_API_KEY             - Azure OpenAI API key
  AZURE_OPENAI_BASE_URL            - Azure OpenAI base URL (https://{resource}.openai.azure.com/openai/v1)
  AZURE_OPENAI_RESOURCE_NAME       - Azure OpenAI resource name (alternative to base URL)
  AZURE_OPENAI_API_VERSION         - Azure OpenAI API version (default: v1)
  AZURE_OPENAI_DEPLOYMENT_NAME_MAP - Azure OpenAI model=deployment map (comma-separated)
  GEMINI_API_KEY                   - Google Gemini API key
  GROQ_API_KEY                     - Groq API key
  CEREBRAS_API_KEY                 - Cerebras API key
  XAI_API_KEY                      - xAI Grok API key
  OPENROUTER_API_KEY               - OpenRouter API key
  AI_GATEWAY_API_KEY               - Vercel AI Gateway API key
  ZAI_API_KEY                      - Z.ai API key
  ZHIPU_API_KEY                    - Zhipu API key
  MISTRAL_API_KEY                  - Mistral API key
  MINIMAX_API_KEY                  - MiniMax API key
  KIMI_API_KEY                     - Kimi For Coding API key
  AWS_PROFILE                      - AWS profile for Amazon Bedrock
  AWS_ACCESS_KEY_ID                - AWS access key for Amazon Bedrock
  AWS_SECRET_ACCESS_KEY            - AWS secret key for Amazon Bedrock
  AWS_BEARER_TOKEN_BEDROCK         - Bedrock API key (bearer token)
  AWS_REGION                       - AWS region for Amazon Bedrock (e.g., us-east-1)
  ${ENV_AGENT_DIR.padEnd(32)} - Session storage directory (default: ~/${CONFIG_DIR_NAME}/agent)
  ${ENV_PACKAGE_DIR.padEnd(32)} - Override package directory (for Nix/Guix store paths)
  PI_OFFLINE                       - Disable startup network operations when set to 1/true/yes
  ${ENV_SHARE_VIEWER_URL.padEnd(32)} - Base URL for /share command (default: https://pi.dev/session/)
  PI_AI_ANTIGRAVITY_VERSION        - Override Antigravity User-Agent version (e.g., 1.23.0)

${chalk.bold(`Available Tools (default: ${defaultToolsList}):`)}
  read   - Read file contents
  bash   - Execute bash commands
  shell  - Execute shell commands (PowerShell on Windows by default)
  edit   - Edit files with find/replace
  write  - Write files (creates/overwrites)
  grep   - Search file contents
  glob   - Find files by glob pattern
  find   - Find files by glob pattern (read-only, off by default)
  ls     - List directory contents (read-only, off by default)
  dir_tree - Show directory tree with [D]/[F] node types (read-only)
  doc_to_pdf - Convert .doc/.docx files to PDF
  html_to_pdf - Convert HTML files to PDF
  extract_text_from_pdf - OCR a PDF (PP-OCRv5, scanned or born-digital) via Vetta Desktop
  extract_text_from_img - OCR a single image (PNG/JPG/WebP/BMP/GIF) via Vetta Desktop
  render_pdf_page - Render a PDF page to PNG for visual inspection (seals, signatures, layout); follow up with read
  current_time - Get the current date and time
  progress - Announce the current stage in plain language (Work mode only, display-only)
  tool_search - Search and activate deferred MCP tools by keyword (auto-enabled when MCP tools exceed the disclosure threshold)
`);
}
