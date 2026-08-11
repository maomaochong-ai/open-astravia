import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
	ConfiguredHookHandler,
	HookConfigLayer,
	HookConfigSource,
	HookDiagnostic,
	HookEventName,
} from "../../hooks/types.js";
import {
	claudeCommandHookHandlerSchema,
	claudeHookConfigRootSchema,
	claudeHookEventGroupsSchema,
	claudeHookHandlerSchema,
	claudeHookMatcherGroupSchema,
	claudeMatcherSchema,
} from "./config-schema.js";
import { eventUsesClaudeMatcher, validateClaudeMatcher } from "./matcher.js";
import {
	expandClaudePlaceholders,
	hasUnresolvedClaudePlaceholder,
	inferPluginRootFromHooksPath,
} from "./placeholders.js";
import { CLAUDE_CODE_HOOK_PROFILE_ID } from "./profile.js";

export interface ClaudeHookDiscoveryResult {
	handlers: ConfiguredHookHandler[];
	diagnostics: HookDiagnostic[];
}

/** Events Vetta host can fire and this profile can load. */
const SUPPORTED_EVENT_NAMES: readonly HookEventName[] = [
	"SessionStart",
	"SessionEnd",
	"UserPromptSubmit",
	"PreToolUse",
	"PermissionRequest",
	"PostToolUse",
	"PostToolUseFailure",
	"PreCompact",
	"PostCompact",
	"SubagentStart",
	"SubagentStop",
	"Stop",
];

const SUPPORTED_EVENT_SET = new Set<string>(SUPPORTED_EVENT_NAMES);

export interface DiscoverClaudeHookHandlersOptions {
	/** Session project directory used for `${CLAUDE_PROJECT_DIR}` when source env omits it. */
	projectDir?: string;
}

export async function discoverClaudeHookHandlers(
	layers: readonly HookConfigLayer[],
	options: DiscoverClaudeHookHandlersOptions = {},
): Promise<ClaudeHookDiscoveryResult> {
	const handlers: ConfiguredHookHandler[] = [];
	const diagnostics: HookDiagnostic[] = [];
	let displayOrder = 0;

	for (const layer of layers) {
		if (!layer.enabled) continue;
		const sources = layer.sources ?? defaultClaudeSources(layer.directory);
		for (const source of sources) {
			if (!isClaudeOwnedSource(source)) continue;
			displayOrder = await appendSource(
				source,
				options.projectDir ?? layer.directory,
				handlers,
				diagnostics,
				displayOrder,
			);
		}
	}

	return { handlers, diagnostics };
}

export function discoverClaudeHookHandlersFromDocument(
	configuration: unknown,
	source: HookConfigSource,
	options: DiscoverClaudeHookHandlersOptions = {},
): ClaudeHookDiscoveryResult {
	const handlers: ConfiguredHookHandler[] = [];
	const diagnostics: HookDiagnostic[] = [];
	appendDocument(
		{ hooks: configuration },
		source,
		options.projectDir ?? process.cwd(),
		handlers,
		diagnostics,
		0,
		true,
	);
	return { handlers, diagnostics };
}

export function isClaudeOwnedSource(source: HookConfigSource): boolean {
	if (source.profileId) return source.profileId.startsWith("claude-code-hooks");
	if (source.env?.CLAUDE_PLUGIN_ROOT) return true;
	const normalized = source.path.replace(/\\/g, "/").toLowerCase();
	// Claude Code plugin layout
	if (normalized.endsWith("/hooks/hooks.json")) return true;
	// Claude settings under any .claude dir (including .vetta/.claude)
	if (normalized.endsWith("/.claude/settings.json")) return true;
	if (normalized.endsWith("/.claude/settings.local.json")) return true;
	return false;
}

/** Default sources when a layer only provides a Claude config directory. */
function defaultClaudeSources(directory: string): HookConfigSource[] {
	const normalized = directory.replace(/\\/g, "/").toLowerCase();
	if (normalized.endsWith("/.claude") || normalized.endsWith("/.claude/")) {
		return [{ path: join(directory, "settings.json") }, { path: join(directory, "settings.local.json") }];
	}
	// Layer is a plugin root: only hooks/hooks.json is official without explicit sources.
	return [{ path: join(directory, "hooks", "hooks.json") }];
}

async function appendSource(
	source: HookConfigSource,
	projectDir: string,
	handlers: ConfiguredHookHandler[],
	diagnostics: HookDiagnostic[],
	displayOrder: number,
): Promise<number> {
	const sourcePath = source.path;
	let text: string;
	try {
		text = await readFile(sourcePath, "utf8");
	} catch (error) {
		if (isMissingFile(error)) return displayOrder;
		diagnostics.push({
			code: "config_read_failed",
			message: `failed to read Claude hooks config: ${errorMessage(error)}`,
			sourcePath,
		});
		return displayOrder;
	}

	// Normalize CRLF so Windows-checked-out plugin fixtures parse the same as LF.
	text = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");

	let root: unknown;
	try {
		root = JSON.parse(text) as unknown;
	} catch (error) {
		diagnostics.push({
			code: "config_parse_failed",
			message: `failed to parse Claude hooks config: ${errorMessage(error)}`,
			sourcePath,
		});
		return displayOrder;
	}
	return appendDocument(root, source, projectDir, handlers, diagnostics, displayOrder);
}

function appendDocument(
	root: unknown,
	source: HookConfigSource,
	projectDir: string,
	handlers: ConfiguredHookHandler[],
	diagnostics: HookDiagnostic[],
	displayOrder: number,
	skipUnsupportedIf = false,
): number {
	const sourcePath = source.path;

	const rootResult = claudeHookConfigRootSchema.safeParse(root);
	if (!rootResult.success) {
		diagnostics.push({
			code: "config_parse_failed",
			message: "Claude hooks config must contain an object-valued hooks field",
			sourcePath,
		});
		return displayOrder;
	}
	const events = rootResult.data.hooks ?? {};

	const pathContext = {
		pluginRoot: source.env?.CLAUDE_PLUGIN_ROOT ?? inferPluginRootFromHooksPath(sourcePath),
		pluginData: source.env?.CLAUDE_PLUGIN_DATA,
		projectDir: source.env?.CLAUDE_PROJECT_DIR ?? projectDir,
	};

	for (const [eventName, rawGroups] of Object.entries(events)) {
		if (!SUPPORTED_EVENT_SET.has(eventName)) {
			diagnostics.push({
				code: "unsupported_event",
				message: `unsupported Claude hook event ${JSON.stringify(eventName)} in this Vetta profile (${CLAUDE_CODE_HOOK_PROFILE_ID})`,
				sourcePath,
			});
			continue;
		}
		const typedEvent = eventName as HookEventName;
		const groupsResult = claudeHookEventGroupsSchema.safeParse(rawGroups);
		if (!groupsResult.success) {
			diagnostics.push({
				code: "config_parse_failed",
				message: `${eventName} must be an array`,
				sourcePath,
			});
			continue;
		}

		for (const rawGroup of groupsResult.data) {
			const groupResult = claudeHookMatcherGroupSchema.safeParse(rawGroup);
			if (!groupResult.success) {
				diagnostics.push({
					code: "invalid_handler",
					message: `invalid ${eventName} matcher group`,
					sourcePath,
				});
				continue;
			}
			const group = groupResult.data;
			const matcher = matcherForEvent(typedEvent, group.matcher);
			if (matcher.invalid) {
				diagnostics.push({
					code: "invalid_matcher",
					message: `invalid matcher ${JSON.stringify(group.matcher)}`,
					sourcePath,
				});
				continue;
			}

			for (const rawHandler of group.hooks ?? []) {
				const handlerResult = claudeHookHandlerSchema.safeParse(rawHandler);
				if (!handlerResult.success) {
					diagnostics.push({
						code: "invalid_handler",
						message: `invalid ${eventName} hook handler`,
						sourcePath,
					});
					continue;
				}
				const handler = handlerResult.data;
				if (
					handler.type === "http" ||
					handler.type === "mcp_tool" ||
					handler.type === "prompt" ||
					handler.type === "agent"
				) {
					diagnostics.push({
						code: "unsupported_handler_type",
						message: `${handler.type} hooks are not supported by ${CLAUDE_CODE_HOOK_PROFILE_ID}`,
						sourcePath,
					});
					continue;
				}
				if (handler.type !== "command") {
					diagnostics.push({
						code: "unsupported_handler_type",
						message: `unknown Claude hook handler type ${JSON.stringify(handler.type)}`,
						sourcePath,
					});
					continue;
				}
				const commandResult = claudeCommandHookHandlerSchema.safeParse(rawHandler);
				if (!commandResult.success) {
					diagnostics.push({
						code: "invalid_handler",
						message: `invalid ${eventName} command hook handler`,
						sourcePath,
					});
					continue;
				}
				const commandHandler = commandResult.data;
				if (commandHandler.async === true || commandHandler.asyncRewake === true) {
					diagnostics.push({
						code: "unsupported_handler_mode",
						message: "async Claude hooks are not supported by this profile",
						sourcePath,
					});
					continue;
				}
				if (commandHandler.if !== undefined) {
					diagnostics.push({
						code: "unsupported_handler_mode",
						message: "Claude handler `if` permission filters are not supported yet",
						sourcePath,
					});
					if (skipUnsupportedIf) continue;
					// Static compatibility sources keep Claude's best-effort, fail-open behavior.
				}

				const defaultTimeout = typedEvent === "UserPromptSubmit" ? 30 : 600;
				const timeoutSeconds = commandHandler.timeout ?? defaultTimeout;
				let command = expandClaudePlaceholders(commandHandler.command, pathContext);
				if (commandHandler.args && commandHandler.args.length > 0) {
					const expandedArgs = commandHandler.args.map((arg) => expandClaudePlaceholders(arg, pathContext));
					// Prefer shell-safe quoting for args form after path expansion.
					command = [quoteIfNeeded(command), ...expandedArgs.map(quoteIfNeeded)].join(" ");
				}

				if (hasUnresolvedClaudePlaceholder(command)) {
					diagnostics.push({
						code: "invalid_handler",
						message: `command still contains unresolved Claude path placeholders: ${command}`,
						sourcePath,
					});
					continue;
				}

				const env: Record<string, string> = { ...(source.env ?? {}) };
				if (pathContext.pluginRoot && env.CLAUDE_PLUGIN_ROOT === undefined) {
					env.CLAUDE_PLUGIN_ROOT = pathContext.pluginRoot;
				}
				if (pathContext.pluginData && env.CLAUDE_PLUGIN_DATA === undefined) {
					env.CLAUDE_PLUGIN_DATA = pathContext.pluginData;
				}
				if (pathContext.projectDir && env.CLAUDE_PROJECT_DIR === undefined) {
					env.CLAUDE_PROJECT_DIR = pathContext.projectDir;
				}

				handlers.push({
					eventName: typedEvent,
					matcher: matcher.value,
					command,
					timeoutMs: Math.max(1, Math.floor(timeoutSeconds)) * 1000,
					statusMessage: commandHandler.statusMessage,
					sourcePath,
					displayOrder,
					env,
					pluginId: source.pluginId,
					once: commandHandler.once === true,
				});
				displayOrder++;
			}
		}
	}
	return displayOrder;
}

function matcherForEvent(
	eventName: HookEventName,
	value: unknown,
): { invalid: false; value?: string } | { invalid: true } {
	if (!eventUsesClaudeMatcher(eventName)) return { invalid: false };
	const result = claudeMatcherSchema.safeParse(value);
	if (!result.success) return { invalid: true };
	const matcher = result.data ?? undefined;
	if (matcher === undefined) return { invalid: false };
	if (matcher.length === 0 || matcher === "*") return { invalid: false, value: matcher };
	return validateClaudeMatcher(matcher) ? { invalid: false, value: matcher } : { invalid: true };
}

function quoteIfNeeded(value: string): string {
	if (value.length === 0) return '""';
	if (/[\s"'$`\\]/.test(value)) return `"${value.replaceAll('"', '\\"')}"`;
	return value;
}

function isMissingFile(error: unknown): boolean {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
