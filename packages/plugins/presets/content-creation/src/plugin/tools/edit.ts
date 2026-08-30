import type { PluginContext } from "@vetta-org/plugin-sdk";
import { CONTENT_AGENT_OPERATION_SCHEMA } from "../../agent/operations";
import type { ContentCreationAgentService } from "../../agent/service";
import {
	CONTENT_PROJECT_DIR_PROPERTY,
	CONTENT_REVISION_PROPERTY,
	CONTENT_TOOL_SCOPE_USE,
	CONTENT_WORKSPACE_TAB_ID,
	type ContentProjectInput,
	resolveContentProjectCwd,
} from "./shared";
import { contentCreationToolError } from "./tool-error";

export const CONTENT_EDIT_TOOL_NAME = "content_creation_edit";

const CONTENT_EDIT_TOOL_DESCRIPTION = `
Atomically modify the content-creation workflow with a revision-bound batch of typed operations. Call content_creation_inspect with view="project" first and pass its revision as expectedRevision.

Use this tool for workflow metadata, nodes, connections, prompts, generation configuration, and deletions. Use content_creation_assets first for user-supplied local media and content_creation_run for generation control. Before authoring image or video work, invoke the matching content-creation skill and follow its method-specific references. Never edit the project JSON directly.

The first call in a session asks the user to confirm because this tool writes to the workspace. It returns the new revision and readiness analysis. An invalid operation rejects the entire batch without partial changes.
`.trim();

interface EditInput extends ContentProjectInput {
	expectedRevision?: number;
	operations: unknown[];
}

export function registerContentEditTool(ctx: PluginContext, agent: ContentCreationAgentService): void {
	ctx.agent.registerTool<EditInput>({
		id: "edit-content-creation",
		name: CONTENT_EDIT_TOOL_NAME,
		label: "%tool.edit.label%",
		description: CONTENT_EDIT_TOOL_DESCRIPTION,
		parameters: {
			type: "object",
			properties: {
				projectDir: CONTENT_PROJECT_DIR_PROPERTY,
				expectedRevision: CONTENT_REVISION_PROPERTY,
				operations: {
					...CONTENT_AGENT_OPERATION_SCHEMA,
					description:
						"Atomic operation batch evaluated in order against one project revision. Follow each operation variant's description and the invoked content-creation skill; any invalid operation rejects the whole batch.",
				},
			},
			required: ["operations"],
			additionalProperties: false,
		},
		scope_use: CONTENT_TOOL_SCOPE_USE,
		handler: async ({ session, trigger }) => {
			try {
				const cwd = resolveContentProjectCwd(trigger.input, session.cwd);
				const project = await agent.edit(cwd, trigger.input.operations, trigger.input.expectedRevision);
				const state = await agent.inspect(cwd);
				ctx.ui.openActivityTab(CONTENT_WORKSPACE_TAB_ID, { width: "max" });
				return {
					ok: true,
					status: "applied",
					projectId: project.projectId,
					revision: project.revision,
					nodeCount: project.graph.nodes.length,
					connectionCount: project.graph.edges.length,
					analysis: state.analysis,
				};
			} catch (error) {
				return contentCreationToolError(error);
			}
		},
	});
}
