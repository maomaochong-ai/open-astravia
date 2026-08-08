import { HookDispatcher } from "../../hooks/dispatcher.js";
import type { EcosystemHookAdapter, EcosystemHookEvent } from "../../hooks/runtime.js";
import type { HookConfigLayer, HookDiagnostic, HookRequest, HookRunSummary } from "../../hooks/types.js";
import { ClaudeHookCommandExecutor } from "./command-executor.js";
import { discoverClaudeHookHandlers, discoverClaudeHookHandlersFromDocument } from "./config.js";
import { CLAUDE_CODE_HOOK_PROFILE_ID, claudeCodeHookProfile } from "./profile.js";
import { mapToolToClaude } from "./tool-mapper.js";

export interface ClaudeHookAdapterOptions {
	configLayers: readonly HookConfigLayer[];
	/** Session cwd; used as default `${CLAUDE_PROJECT_DIR}`. */
	projectDir?: string;
	onDiagnostic?: (diagnostic: HookDiagnostic) => void;
	onFailedRun?: (summary: HookRunSummary) => void;
}

export async function createClaudeHookAdapter(options: ClaudeHookAdapterOptions): Promise<EcosystemHookAdapter> {
	const discovery = await discoverClaudeHookHandlers(options.configLayers, {
		projectDir: options.projectDir,
	});
	for (const diagnostic of discovery.diagnostics) options.onDiagnostic?.(diagnostic);

	if (discovery.handlers.length > 0 || discovery.diagnostics.length > 0) {
		const byEvent: Record<string, number> = {};
		for (const handler of discovery.handlers) {
			byEvent[handler.eventName] = (byEvent[handler.eventName] ?? 0) + 1;
		}
		const sources = options.configLayers.flatMap((layer) =>
			(
				layer.sources ?? [
					{ path: `${layer.directory}/settings.json` },
					{ path: `${layer.directory}/settings.local.json` },
				]
			)
				.filter((source) => source.profileId?.startsWith("claude-code-hooks") || !source.profileId)
				.map((source) => source.path),
		);
		console.info("[ecosystem-hooks] claude handlers loaded", {
			profile: CLAUDE_CODE_HOOK_PROFILE_ID,
			total: discovery.handlers.length,
			byEvent,
			sources,
			diagnostics: discovery.diagnostics.length,
		});
	}

	const dispatcher = new HookDispatcher({
		profile: claudeCodeHookProfile,
		handlers: discovery.handlers,
		executor: new ClaudeHookCommandExecutor(),
		observer: { onRunCompleted: options.onFailedRun },
	});

	return {
		id: CLAUDE_CODE_HOOK_PROFILE_ID,
		supports: () => true,
		dispatch: (event, signal) => dispatcher.dispatch(toClaudeRequest(event), signal),
		async registerContribution(source) {
			const dynamic = discoverClaudeHookHandlersFromDocument(
				source.configuration,
				{
					path: source.sourcePath,
					env: source.env,
					pluginId: source.pluginId,
					profileId: source.profileId,
				},
				{ projectDir: options.projectDir },
			);
			for (const diagnostic of dynamic.diagnostics) options.onDiagnostic?.(diagnostic);
			return dispatcher.registerContribution({
				id: source.id,
				revision: source.revision,
				handlers: dynamic.handlers,
			});
		},
		resetSessionState: () => dispatcher.resetSessionState(),
	};
}

function toClaudeRequest(event: EcosystemHookEvent): HookRequest {
	const common = {
		sessionId: event.sessionId,
		cwd: event.cwd,
		transcriptPath: event.transcriptPath,
		model: event.model,
		permissionMode: event.permissionMode,
	};
	switch (event.eventName) {
		case "SessionStart":
			return { ...common, eventName: event.eventName, source: event.source };
		case "SessionEnd":
			return { ...common, eventName: event.eventName, cause: event.cause };
		case "UserPromptSubmit":
			return {
				...common,
				eventName: event.eventName,
				turnId: event.turnId,
				prompt: event.prompt,
				subagent: event.subagent,
			};
		case "PreToolUse":
			return {
				...common,
				eventName: event.eventName,
				turnId: event.turnId,
				tool: mapToolToClaude(event.tool),
				toolUseId: event.toolUseId,
				toolInput: event.toolInput,
				subagent: event.subagent,
			};
		case "PermissionRequest":
			return {
				...common,
				eventName: event.eventName,
				turnId: event.turnId,
				tool: mapToolToClaude(event.tool),
				toolInput: event.toolInput,
				runIdSuffix: event.runIdSuffix,
				subagent: event.subagent,
			};
		case "PostToolUse":
			return {
				...common,
				eventName: event.eventName,
				turnId: event.turnId,
				tool: mapToolToClaude(event.tool),
				toolUseId: event.toolUseId,
				toolInput: event.toolInput,
				toolResponse: event.toolResponse,
				subagent: event.subagent,
			};
		case "PostToolUseFailure":
			return {
				...common,
				eventName: event.eventName,
				turnId: event.turnId,
				tool: mapToolToClaude(event.tool),
				toolUseId: event.toolUseId,
				toolInput: event.toolInput,
				error: event.error,
				isInterrupt: event.isInterrupt,
				durationMs: event.durationMs,
				subagent: event.subagent,
			};
		case "PreCompact":
		case "PostCompact":
			return {
				...common,
				eventName: event.eventName,
				turnId: event.turnId,
				trigger: event.trigger,
				subagent: event.subagent,
			};
		case "SubagentStart":
			return {
				...common,
				eventName: event.eventName,
				turnId: event.turnId,
				agentId: event.agentId,
				agentType: event.agentType,
			};
		case "SubagentStop":
			return {
				...common,
				eventName: event.eventName,
				turnId: event.turnId,
				agentId: event.agentId,
				agentType: event.agentType,
				agentTranscriptPath: event.agentTranscriptPath,
				stopHookActive: event.stopHookActive,
				lastAssistantMessage: event.lastAssistantMessage,
			};
		case "Stop":
			return {
				...common,
				eventName: event.eventName,
				turnId: event.turnId,
				stopHookActive: event.stopHookActive,
				lastAssistantMessage: event.lastAssistantMessage,
			};
	}
}
