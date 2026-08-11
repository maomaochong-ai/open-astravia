export const WAIT_AGENT_TOOL_DESCRIPTION =
	"Wait until one or more subagents reach a terminal state. Event-driven (no polling). Consumes the completion so a <subagent_notification> will not re-deliver the same result. " +
	"NEVER use this for workflow children: they push <subagent_notification> on completion — after dispatch_workflows, end your turn and receive results passively.";

export const WORKFLOW_NO_WAIT_TEXT =
	"Not waiting: all pending children are workflows, which notify you automatically via <subagent_notification> as each finishes. " +
	"Blocking here would only freeze this conversation. End your turn now (or continue other work) and react to the notifications passively.";
