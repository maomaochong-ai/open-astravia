import { CODING_AGENT_BUILT_IN_TOOL_NAMES } from "@vetta/coding-agent/bootstrap";
import {
	APP_NAME,
	CONFIG_DIR_NAME,
	ENV_AGENT_DIR,
	ENV_PACKAGE_DIR,
	ENV_SHARE_VIEWER_URL,
} from "@vetta/coding-agent/config";
import chalk from "chalk";

/** Render the Node CLI help text. Product option names come from Coding Agent; terminal presentation stays here. */
export function printAgentHelp(): void {
	const defaultCommandTool = process.platform === "win32" ? "shell" : "bash";
	const defaultTools = `read,${defaultCommandTool},edit,write,grep,glob,dir_tree,doc_to_pdf,html_to_pdf,extract_text_from_pdf,extract_text_from_img,render_pdf_page,current_time`;

	console.log(`${chalk.bold(APP_NAME)} - AI coding assistant with ${defaultTools} tools

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
  --no-tools                     Disable all built-in tools
  --tools <tools>                Comma-separated tools (default: ${defaultTools})
                                 Available: ${CODING_AGENT_BUILT_IN_TOOL_NAMES.join(", ")}
  --thinking <level>             Set thinking level: off, minimal, low, medium, high, xhigh
  --extension, -e <path>         Load an extension file (repeatable)
  --no-extensions, -ne           Disable extension discovery
  --skill <path>                 Load a skill file or directory (repeatable)
  --no-skills, -ns               Disable skills discovery and loading
  --prompt-template <path>       Load a prompt template file or directory (repeatable)
  --no-prompt-templates, -np     Disable prompt template discovery and loading
  --theme <path>                 Load a theme file or directory (repeatable)
  --no-themes                    Disable theme discovery and loading
  --export <file>                Export session file to HTML and exit
  --list-models [search]         List available models (with optional fuzzy search)
  --verbose                      Force verbose startup
  --enable-host-bridge           Enable the host bridge in RPC mode
  --memory-mode                  Enable MEMORY.md cross-session memory in RPC mode
  --memory-file <path>           Absolute path to MEMORY.md
  --offline                      Disable startup network operations
  --help, -h                     Show this help
  --version, -v                  Show version number

Extensions can register additional flags (for example, --plan).

${chalk.bold("Examples:")}
  ${APP_NAME}
  ${APP_NAME} "List all .ts files in src/"
  ${APP_NAME} @prompt.md @image.png "What color is the sky?"
  ${APP_NAME} -p "List all .ts files in src/"
  ${APP_NAME} --continue "What did we discuss?"
  ${APP_NAME} --provider openai --model gpt-4o-mini "Help me refactor this code"
  ${APP_NAME} --model openai/gpt-4o "Help me refactor this code"
  ${APP_NAME} --model sonnet:high "Solve this complex problem"
  ${APP_NAME} --models "github-copilot/*"
  ${APP_NAME} --tools read,grep,glob,find,ls,dir_tree -p "Review the code in src/"
  ${APP_NAME} --export ~/${CONFIG_DIR_NAME}/agent/sessions/--path--/session.jsonl
  ${APP_NAME} --export session.jsonl output.html

${chalk.bold("Environment Variables:")}
  ANTHROPIC_API_KEY                - Anthropic Claude API key
  ANTHROPIC_OAUTH_TOKEN            - Anthropic OAuth token
  OPENAI_API_KEY                   - OpenAI GPT API key
  AZURE_OPENAI_API_KEY             - Azure OpenAI API key
  AZURE_OPENAI_BASE_URL            - Azure OpenAI base URL
  AZURE_OPENAI_RESOURCE_NAME       - Azure OpenAI resource name
  AZURE_OPENAI_API_VERSION         - Azure OpenAI API version
  AZURE_OPENAI_DEPLOYMENT_NAME_MAP - Azure OpenAI model=deployment map
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
  AWS_BEARER_TOKEN_BEDROCK         - Bedrock bearer token
  AWS_REGION                       - AWS region for Amazon Bedrock
  ${ENV_AGENT_DIR.padEnd(32)} - Session storage directory (default: ~/${CONFIG_DIR_NAME}/agent)
  ${ENV_PACKAGE_DIR.padEnd(32)} - Override package directory
  PI_OFFLINE                       - Disable startup network operations
  ${ENV_SHARE_VIEWER_URL.padEnd(32)} - Base URL for /share
  PI_AI_ANTIGRAVITY_VERSION        - Override Antigravity User-Agent version

${chalk.bold(`Available Tools (default: ${defaultTools}):`)}
  read, bash, shell, edit, write, grep, glob, find, ls, dir_tree,
  doc_to_pdf, html_to_pdf, extract_text_from_pdf, extract_text_from_img,
  render_pdf_page, current_time, progress, tool_search
`);
}
