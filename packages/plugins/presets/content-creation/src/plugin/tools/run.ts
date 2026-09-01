import type { ContentCreationAgentService } from "../../agent/service";
import type { ContentRunApprovalStore } from "../run-approval";
import {
	CONTENT_PROJECT_DIR_PROPERTY,
	CONTENT_REVISION_PROPERTY,
	type ContentProjectInput,
	resolveContentProjectCwd,
} from "./shared";
import { contentCreationToolError } from "./tool-error";

export const CONTENT_RUN_OPERATION_DESCRIPTION = `
Prepare, inspect, or cancel a revision-bound image or video generation run. Before prepare, execute inspect with view="readiness" and repair blocking diagnostics.

Prepare does not spend quota. It opens a global confirmation dialog, and only the user can start generation. Use the runId returned by prepare for status or cancel. Optionally use nodeIds to limit prepare to selected generator nodes.
`.trim();

export interface RunInput extends ContentProjectInput {
	action: "prepare" | "status" | "cancel";
	expectedRevision?: number;
	nodeIds?: string[];
	runId?: string;
}

export const CONTENT_RUN_INPUT_SCHEMA = {
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
} as const;

export async function executeContentRun(
	agent: ContentCreationAgentService,
	runApprovals: ContentRunApprovalStore,
	sessionCwd: string,
	input: RunInput,
) {
	try {
		if (input.action === "prepare") {
			const run = await agent.prepareRun(
				resolveContentProjectCwd(input, sessionCwd),
				input.nodeIds,
				input.expectedRevision,
			);
			runApprovals.request(run.id);
			return { ok: true, status: "awaiting-confirmation", run };
		}
		const runId = requiredRunId(input.runId);
		if (input.action === "cancel") agent.cancelRun(runId);
		const run = agent.getRun(runId);
		return run ? { ok: true, run } : { ok: false, retryable: false, error: "content run not found" };
	} catch (error) {
		return contentCreationToolError(error);
	}
}

function requiredRunId(runId?: string): string {
	if (!runId?.trim()) throw new Error("runId is required for status or cancel");
	return runId;
}
