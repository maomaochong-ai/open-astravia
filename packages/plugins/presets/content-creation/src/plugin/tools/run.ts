import type { PluginContext } from "@vetta-org/plugin-sdk";
import type { ContentCreationAgentService } from "../../agent/service";
import type { ContentRunApprovalStore } from "../run-approval";
import {
	CONTENT_PROJECT_DIR_PROPERTY,
	CONTENT_REVISION_PROPERTY,
	CONTENT_TOOL_SCOPE_USE,
	type ContentProjectInput,
	resolveContentProjectCwd,
} from "./shared";
import { contentCreationToolError } from "./tool-error";

export const CONTENT_RUN_TOOL_NAME = "content_creation_run";

const CONTENT_RUN_TOOL_DESCRIPTION = `
Prepare, inspect, or cancel a revision-bound image or video generation run. Before prepare, check content_creation_inspect with view="readiness" and repair blocking diagnostics.

Prepare does not spend quota. It opens a global confirmation dialog, and only the user can start generation. Use the runId returned by prepare for status or cancel. Optionally use nodeIds to limit prepare to selected generator nodes.
`.trim();

interface RunInput extends ContentProjectInput {
	action: "prepare" | "status" | "cancel";
	expectedRevision?: number;
	nodeIds?: string[];
	runId?: string;
}

export function registerContentRunTool(
	ctx: PluginContext,
	agent: ContentCreationAgentService,
	runApprovals: ContentRunApprovalStore,
): void {
	ctx.agent.registerTool<RunInput>({
		id: "run-content-creation",
		name: CONTENT_RUN_TOOL_NAME,
		label: "%tool.run.label%",
		description: CONTENT_RUN_TOOL_DESCRIPTION,
		parameters: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: ["prepare", "status", "cancel"],
					description:
						"prepare validates and stages work for user confirmation; status reads an existing run; cancel requests cancellation of an existing run.",
				},
				projectDir: CONTENT_PROJECT_DIR_PROPERTY,
				expectedRevision: CONTENT_REVISION_PROPERTY,
				nodeIds: {
					type: "array",
					minItems: 1,
					items: { type: "string" },
					description:
						"Optional generator node IDs to include in prepare. Omit to prepare every runnable generator in the project.",
				},
				runId: {
					type: "string",
					description: "Run identifier returned by prepare. Required for status and cancel.",
				},
			},
			required: ["action"],
			additionalProperties: false,
		},
		scope_use: CONTENT_TOOL_SCOPE_USE,
		handler: async ({ session, trigger }) => {
			try {
				if (trigger.input.action === "prepare") {
					const run = await agent.prepareRun(
						resolveContentProjectCwd(trigger.input, session.cwd),
						trigger.input.nodeIds,
						trigger.input.expectedRevision,
					);
					runApprovals.request(run.id);
					return { ok: true, status: "awaiting-confirmation", run };
				}
				const runId = requiredRunId(trigger.input.runId);
				if (trigger.input.action === "cancel") agent.cancelRun(runId);
				const run = agent.getRun(runId);
				return run ? { ok: true, run } : { ok: false, retryable: false, error: "content run not found" };
			} catch (error) {
				return contentCreationToolError(error);
			}
		},
	});
}

function requiredRunId(runId?: string): string {
	if (!runId?.trim()) throw new Error("runId is required for status or cancel");
	return runId;
}
