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
	codexCommandHookHandlerSchema,
	codexHookConfigRootSchema,
	codexHookEventGroupsSchema,
	codexHookHandlerSchema,
	codexHookMatcherGroupSchema,
	codexMatcherSchema,
} from "./config-schema.js";
import { eventUsesLatestCodexMatcher, validateLatestCodexMatcher } from "./latest/matcher.js";

export interface CodexHookDiscoveryResult {
	handlers: ConfiguredHookHandler[];
	diagnostics: HookDiagnostic[];
}

const EVENT_NAMES: readonly HookEventName[] = [
	"PreToolUse",
	"PermissionRequest",
	"PostToolUse",
	"PreCompact",
	"PostCompact",
	"SessionStart",
	"UserPromptSubmit",
	"SubagentStart",
	"SubagentStop",
	"Stop",
];

export async function discoverCodexHookHandlers(layers: readonly HookConfigLayer[]): Promise<CodexHookDiscoveryResult> {
	const handlers: ConfiguredHookHandler[] = [];
	const diagnostics: HookDiagnostic[] = [];
	let displayOrder = 0;

	for (const layer of layers) {
		if (!layer.enabled) continue;
		const sources = layer.sources ?? [{ path: join(layer.directory, "hooks.json") }];
		for (const source of sources) {
			if (!isCodexOwnedSource(source)) continue;
			displayOrder = await appendSource(source, handlers, diagnostics, displayOrder);
		}
	}

	return { handlers, diagnostics };
}

async function appendSource(
	source: HookConfigSource,
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
			message: `failed to read hooks config: ${errorMessage(error)}`,
			sourcePath,
		});
		return displayOrder;
	}

	let root: unknown;
	try {
		root = JSON.parse(text) as unknown;
	} catch (error) {
		diagnostics.push({
			code: "config_parse_failed",
			message: `failed to parse hooks config: ${errorMessage(error)}`,
			sourcePath,
		});
		return displayOrder;
	}

	const rootResult = codexHookConfigRootSchema.safeParse(root);
	if (!rootResult.success) {
		diagnostics.push({
			code: "config_parse_failed",
			message: "hooks config must contain an object-valued hooks field",
			sourcePath,
		});
		return displayOrder;
	}
	const events = rootResult.data.hooks ?? {};

	for (const eventName of EVENT_NAMES) {
		const rawGroups = events[eventName];
		if (rawGroups === undefined) continue;
		const groupsResult = codexHookEventGroupsSchema.safeParse(rawGroups);
		if (!groupsResult.success) {
			diagnostics.push({
				code: "config_parse_failed",
				message: `${eventName} must be an array`,
				sourcePath,
			});
			continue;
		}

		for (const rawGroup of groupsResult.data) {
			const groupResult = codexHookMatcherGroupSchema.safeParse(rawGroup);
			if (!groupResult.success) {
				diagnostics.push({
					code: "invalid_handler",
					message: `invalid ${eventName} matcher group`,
					sourcePath,
				});
				continue;
			}
			const group = groupResult.data;
			const matcher = matcherForEvent(eventName, group.matcher);
			if (matcher.invalid) {
				diagnostics.push({
					code: "invalid_matcher",
					message: `invalid matcher ${JSON.stringify(group.matcher)}`,
					sourcePath,
				});
				continue;
			}

			for (const rawHandler of group.hooks ?? []) {
				const handlerResult = codexHookHandlerSchema.safeParse(rawHandler);
				if (!handlerResult.success) {
					diagnostics.push({
						code: "invalid_handler",
						message: `invalid ${eventName} hook handler`,
						sourcePath,
					});
					continue;
				}
				const handler = handlerResult.data;
				if (handler.type === "prompt" || handler.type === "agent") {
					diagnostics.push({
						code: "unsupported_handler_type",
						message: `${handler.type} hooks are not supported by this Codex profile`,
						sourcePath,
					});
					continue;
				}
				if (handler.type !== "command") {
					diagnostics.push({
						code: "unsupported_handler_type",
						message: `unknown hook handler type ${JSON.stringify(handler.type)}`,
						sourcePath,
					});
					continue;
				}
				const commandResult = codexCommandHookHandlerSchema.safeParse(rawHandler);
				if (!commandResult.success) {
					const invalidField = commandResult.error.issues[0]?.path[0];
					diagnostics.push({
						code: "invalid_handler",
						message:
							invalidField === "command"
								? "command hook must contain a non-empty command"
								: invalidField === "timeout" || invalidField === "timeoutSec"
									? "hook timeout must be a non-negative number"
									: `invalid ${eventName} command hook handler`,
						sourcePath,
					});
					continue;
				}
				const commandHandler = commandResult.data;
				if (commandHandler.async === true) {
					diagnostics.push({
						code: "unsupported_handler_mode",
						message: "async hooks are not supported by this Codex profile",
						sourcePath,
					});
					continue;
				}
				const timeoutSeconds = commandHandler.timeout ?? commandHandler.timeoutSec ?? 600;
				const windowsCommand = commandHandler.commandWindows ?? commandHandler.command_windows;
				const command =
					process.platform === "win32" && windowsCommand !== undefined ? windowsCommand : commandHandler.command;
				handlers.push({
					eventName,
					matcher: matcher.value,
					command,
					timeoutMs: Math.max(1, Math.floor(timeoutSeconds)) * 1000,
					statusMessage: commandHandler.statusMessage,
					sourcePath,
					displayOrder,
					env: source.env,
					pluginId: source.pluginId,
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
	if (!eventUsesLatestCodexMatcher(eventName)) return { invalid: false };
	const result = codexMatcherSchema.safeParse(value);
	if (!result.success) return { invalid: true };
	const matcher = result.data ?? undefined;
	if (matcher === undefined) return { invalid: false };
	if (matcher.length === 0 || matcher === "*") return { invalid: false, value: matcher };
	return validateLatestCodexMatcher(matcher) ? { invalid: false, value: matcher } : { invalid: true };
}

/**
 * Whether this config path belongs to the Codex profile.
 * Matches any `.../.codex/hooks.json` (Astravia-nested `~/.astravia/.codex/...` or top-level official).
 * Claude settings and Claude plugin hooks/hooks.json are never Codex-owned.
 * Codex plugin hooks should set profileId (or an explicit owned path).
 */
export function isCodexOwnedSource(source: HookConfigSource): boolean {
	if (source.profileId) return source.profileId.startsWith("codex-hooks");
	if (source.env?.CLAUDE_PLUGIN_ROOT) return false;
	const normalized = source.path.replace(/\\/g, "/").toLowerCase();
	if (normalized.includes("/.claude/")) return false;
	if (normalized.endsWith("/settings.json") || normalized.endsWith("/settings.local.json")) return false;
	// Codex hooks.json under any .codex dir (including .astravia/.codex)
	if (normalized.endsWith("/.codex/hooks.json")) return true;
	return false;
}

function isMissingFile(error: unknown): boolean {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
