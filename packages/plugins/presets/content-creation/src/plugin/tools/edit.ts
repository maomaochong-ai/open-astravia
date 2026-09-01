import type { PluginContext } from "@vetta-org/plugin-sdk";
import { CONTENT_AGENT_OPERATION_SCHEMA } from "../../agent/operations";
import type { ContentCreationAgentService } from "../../agent/service";
import {
	CONTENT_PROJECT_DIR_PROPERTY,
	CONTENT_REVISION_PROPERTY,
	CONTENT_WORKSPACE_TAB_ID,
	type ContentProjectInput,
	resolveContentProjectCwd,
} from "./shared";
import { contentCreationToolError } from "./tool-error";

export const CONTENT_EDIT_OPERATION_DESCRIPTION = `
Atomically modify the content-creation workflow with a revision-bound batch of typed operations. Execute inspect with view="project" first and pass its revision as expectedRevision.

Use this operation for workflow metadata, nodes, connections, prompts, generation configuration, and deletions. Use assets first for user-supplied local media and run for generation control. Before authoring image or video work, invoke the matching content-creation skill and follow its method-specific references. Never edit the project JSON directly.

The batch applies directly and returns the new revision and readiness analysis. An invalid operation rejects the entire batch without partial changes.
`.trim();

export interface EditInput extends ContentProjectInput {
	expectedRevision?: number;
	operations: unknown[];
}

export const CONTENT_EDIT_INPUT_SCHEMA = {
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
} as const;

export async function executeContentEdit(
	ctx: PluginContext,
	agent: ContentCreationAgentService,
	sessionCwd: string,
	input: EditInput,
) {
	try {
		const cwd = resolveContentProjectCwd(input, sessionCwd);
		const project = await agent.edit(cwd, input.operations, input.expectedRevision);
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
}
