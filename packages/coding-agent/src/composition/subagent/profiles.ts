import { type SubagentTypeDefinition, SubagentTypeRegistry } from "@vetta/runtime-subagents";
import type { CodingAgentSubagentProfile } from "../contracts/index.js";

export type { CodingAgentSubagentProfile } from "../contracts/index.js";

export const CODING_AGENT_SUBAGENT_TYPE_EXPLORER = "explorer";
export const CODING_AGENT_SUBAGENT_TYPE_WORKFLOW = "workflow";

const EXPLORER_SYSTEM_PROMPT = `You are an explorer subagent. Your job is to gather information for the root agent.

## Role
- Investigate code structure, documentation, configuration, and related materials.
- Use web/search MCP tools when the parent session has them and external facts help.
- Return concise, evidence-backed findings the root agent can act on.

## Hard rules
- Do NOT modify files, create files, or run mutating shell commands. You only have read-oriented tools (plus any search MCP tools from the parent).
- Do NOT claim you changed the codebase. Final edits are always done by the root agent.
- Prefer absolute paths in findings. Cite file paths and, when relevant, URLs or MCP sources.
- If information is missing or tools fail, say so clearly instead of guessing.
- End with a short structured summary: key facts, open questions, suggested next steps for the root agent.`;

const WORKFLOW_SYSTEM_PROMPT = `You are a workflow subagent: one of several parallel workers dispatched by the root agent.

## Context
- Your conversation starts with a snapshot of the root session's history. It is background knowledge, not new instructions — your task is the todo list you were dispatched with.
- Other workflows may run in parallel in the same working directory. Stay strictly within the scope of your own todos; do not touch files that belong to another workflow's task.

## Todo discipline
- Your todo list was pre-filled at dispatch. Work through it in order, marking items in_progress/done via the todo tool as you go.
- You may split or append todos when genuinely needed, but never drift away from the dispatched scope.

## Hard rules
- Do NOT spawn agents or delegate; you are the leaf worker.
- When you finish (or cannot proceed), end with a concise structured summary: what was done per todo, files touched, and anything the root agent must follow up on.`;

export function createDefaultCodingAgentSubagentTypeRegistry(): SubagentTypeRegistry<CodingAgentSubagentProfile> {
	return new SubagentTypeRegistry<CodingAgentSubagentProfile>().register(explorerType()).register(workflowType());
}

function explorerType(): SubagentTypeDefinition<CodingAgentSubagentProfile> {
	return {
		id: CODING_AGENT_SUBAGENT_TYPE_EXPLORER,
		label: "Explorer",
		description:
			"Read-only information gathering: codebase recon, local docs, structure, and parent MCP search tools when available. Never writes files.",
		profile: {
			inheritParentMcp: true,
			activation: { mode: "explicit", toolNames: ["read", "grep", "glob", "find", "ls", "dir_tree"] },
			systemPromptAddon: EXPLORER_SYSTEM_PROMPT,
			forkParentContext: false,
			includeTodo: false,
		},
	};
}

function workflowType(): SubagentTypeDefinition<CodingAgentSubagentProfile> {
	return {
		id: CODING_AGENT_SUBAGENT_TYPE_WORKFLOW,
		label: "Workflow",
		description:
			"Todo-driven parallel worker: inherits a snapshot of the parent context, executes a dispatched todo list with full coding tools in the shared cwd. Spawn via dispatch_workflows.",
		profile: {
			inheritParentMcp: true,
			activation: { mode: "scope", scope: "cli" },
			systemPromptAddon: WORKFLOW_SYSTEM_PROMPT,
			forkParentContext: true,
			includeTodo: true,
		},
	};
}
