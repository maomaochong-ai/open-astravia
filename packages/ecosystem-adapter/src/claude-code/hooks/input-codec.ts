import type { HookRequest, SubagentHookContext } from "../../hooks/types.js";
import { toClaudeSessionEndReason } from "./session-end-reason.js";

export function encodeClaudeHookInput(request: HookRequest): string {
	const common = {
		session_id: request.sessionId,
		transcript_path: request.transcriptPath,
		cwd: request.cwd,
		permission_mode: request.permissionMode,
		hook_event_name: request.eventName,
	};

	switch (request.eventName) {
		case "SessionStart":
			return JSON.stringify({
				...common,
				source: request.source,
				model: request.model,
			});
		case "SessionEnd":
			// Wire field stays Claude's `reason`; host uses Astravia `cause`.
			return JSON.stringify({
				...common,
				reason: toClaudeSessionEndReason(request.cause),
			});
		case "UserPromptSubmit":
			return JSON.stringify({
				...common,
				...subagentFields(request.subagent),
				prompt: request.prompt,
			});
		case "PreToolUse":
			return JSON.stringify({
				...common,
				...subagentFields(request.subagent),
				tool_name: request.tool.name,
				tool_input: request.toolInput,
				tool_use_id: request.toolUseId,
			});
		case "PermissionRequest":
			return JSON.stringify({
				...common,
				...subagentFields(request.subagent),
				tool_name: request.tool.name,
				tool_input: request.toolInput,
			});
		case "PostToolUse":
			return JSON.stringify({
				...common,
				...subagentFields(request.subagent),
				tool_name: request.tool.name,
				tool_input: request.toolInput,
				tool_response: request.toolResponse,
				tool_use_id: request.toolUseId,
			});
		case "PostToolUseFailure":
			return JSON.stringify({
				...common,
				...subagentFields(request.subagent),
				tool_name: request.tool.name,
				tool_input: request.toolInput,
				tool_use_id: request.toolUseId,
				error: request.error,
				...(request.isInterrupt !== undefined ? { is_interrupt: request.isInterrupt } : {}),
				...(request.durationMs !== undefined ? { duration_ms: request.durationMs } : {}),
			});
		case "PreCompact":
		case "PostCompact":
			return JSON.stringify({
				...common,
				...subagentFields(request.subagent),
				trigger: request.trigger,
			});
		case "SubagentStart":
			return JSON.stringify({
				...common,
				agent_id: request.agentId,
				agent_type: request.agentType,
			});
		case "SubagentStop":
			return JSON.stringify({
				...common,
				agent_id: request.agentId,
				agent_type: request.agentType,
				agent_transcript_path: request.agentTranscriptPath,
				stop_hook_active: request.stopHookActive,
				last_assistant_message: request.lastAssistantMessage,
			});
		case "Stop":
			return JSON.stringify({
				...common,
				stop_hook_active: request.stopHookActive,
				last_assistant_message: request.lastAssistantMessage,
			});
	}
}

function subagentFields(context: SubagentHookContext | undefined): Record<string, string> {
	return context ? { agent_id: context.agentId, agent_type: context.agentType } : {};
}
