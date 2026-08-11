import type { ContentModelDescriptor } from "../generation/types";
import { CONTENT_NODE_DEFINITIONS } from "../node/definitions";
import { listConnectedPromptSources, resolveContentPrompt } from "../node/prompt-sources";
import { serializeContentProject } from "../project/persistence";
import type { ContentNode, ContentProjectDocument, GenerationJob } from "../project/types";
import { analyzeVideoPromptMethod, VIDEO_PROMPT_PLAN_FIELD_GUIDANCE } from "./generation-prompt-plan";
import { analyzeContentWorkflow } from "./workflow-analysis";

export type ContentAgentDiagnosticSeverity = "error" | "warning" | "info";

export interface ContentAgentDiagnostic {
	code: string;
	severity: ContentAgentDiagnosticSeverity;
	message: string;
	nodeId?: string;
	retryable?: boolean;
	details?: Record<string, unknown>;
}

export function createContentCreationAgentState(
	project: ContentProjectDocument,
	models: readonly ContentModelDescriptor[] = [],
) {
	const document = serializeContentProject(project);
	const baseDiagnostics = diagnoseContentProject(project, models);
	const analysis = analyzeContentWorkflow(project, models, baseDiagnostics);
	const assets = document.assets.map(({ source, createdAt: _assetCreatedAt, ...asset }) => ({
		...asset,
		...(source.storage === "workspace" ? { workspacePath: source.path } : {}),
	}));
	return {
		format: document.format,
		schemaVersion: document.schemaVersion,
		revision: document.revision,
		projectId: document.projectId,
		workflow: document.workflow,
		nodes: document.nodes,
		assets,
		runtime: {
			nodes: project.graph.nodes.map(({ id: nodeId, status }) => ({ nodeId, status })),
			jobs: project.jobs.map(projectJobForAgent),
		},
		capabilities: {
			nodeTypes: CONTENT_NODE_DEFINITIONS.map((definition) => ({
				type: definition.kind,
				category: definition.category,
				inputs: definition.inputs.map(({ id, dataType, multiple }) => ({ id, dataType, multiple: multiple ?? false })),
				outputs: definition.outputs.map(({ id, dataType, multiple }) => ({ id, dataType, multiple: multiple ?? false })),
			})),
			models: models.map(modelForAgent),
		},
		analysis,
		diagnostics: analysis.issues,
	};
}

export function diagnoseContentProject(
	project: ContentProjectDocument,
	models: readonly ContentModelDescriptor[],
): ContentAgentDiagnostic[] {
	const diagnostics: ContentAgentDiagnostic[] = [];
	for (const node of project.graph.nodes) {
		if (node.kind === "image-generator" || node.kind === "video-generator") {
			diagnoseGenerator(project, node, models, diagnostics);
		}
		if (
			node.kind === "output" &&
			!project.graph.edges.some((edge) => edge.target === node.id)
		) {
			diagnostics.push({
				code: "output-without-input",
				severity: "warning",
				nodeId: node.id,
				message: "Output node has no connected content source.",
			});
		}
	}
	if (project.workflow.deliverables.length === 0) {
		diagnostics.push({
			code: "deliverables-not-defined",
			severity: "info",
			message: "The workflow does not define any deliverables.",
		});
	}
	return diagnostics;
}

function diagnoseGenerator(
	project: ContentProjectDocument,
	node: ContentNode,
	models: readonly ContentModelDescriptor[],
	diagnostics: ContentAgentDiagnostic[],
): void {
	const prompt = resolveContentPrompt(listConnectedPromptSources(project, node.id), node.data);
	if (!prompt) {
		diagnostics.push({
			code: "generation-prompt-missing",
			severity: "error",
			nodeId: node.id,
			message: "Generation node has no effective prompt.",
		});
	} else if (node.kind === "video-generator") {
		const issues = analyzeVideoPromptMethod(prompt);
		if (issues.length > 0) {
			diagnostics.push({
				code: "video-prompt-method-incomplete",
				severity: "warning",
				nodeId: node.id,
				message: "The effective video prompt does not fully describe the production method.",
				retryable: true,
				details: {
					issues,
					requiredFields: VIDEO_PROMPT_PLAN_FIELD_GUIDANCE,
					recommendedSkill: "direct-video-creation",
					recommendedOperationField: "promptPlan",
				},
			});
		}
	}
	const outputKind = node.kind === "image-generator" ? "image" : "video";
	const available = models.filter((model) => model.outputKind === outputKind);
	if (available.length === 0) {
		diagnostics.push({
			code: "generation-provider-unavailable",
			severity: "error",
			nodeId: node.id,
			message: `No ${outputKind} generation model is currently available.`,
			retryable: false,
		});
	} else if (
		node.data.providerId &&
		node.data.modelId &&
		!available.some(
			(model) => model.providerId === node.data.providerId && model.modelId === node.data.modelId,
		)
	) {
		diagnostics.push({
			code: "selected-model-unavailable",
			severity: "error",
			nodeId: node.id,
			message: `Selected model is unavailable: ${node.data.providerId}/${node.data.modelId}.`,
			retryable: true,
		});
	}
	const failed = latestJob(project.jobs, node.id, "failed");
	if (failed) {
		diagnostics.push({
			code: failed.errorCode ?? "generation-failed",
			severity: "error",
			nodeId: node.id,
			message: truncateError(failed.error ?? "Generation failed."),
			retryable: failed.errorCode !== "content-rejected" && failed.errorCode !== "not-entitled",
		});
	}
}

function projectJobForAgent(job: GenerationJob) {
	return {
		id: job.id,
		nodeId: job.nodeId,
		provider: job.provider,
		model: job.model,
		status: job.status,
		progress: job.progress,
		...(job.assetId ? { assetId: job.assetId } : {}),
		...(job.errorCode ? { errorCode: job.errorCode } : {}),
		...(job.error ? { error: truncateError(job.error) } : {}),
	};
}

function modelForAgent(model: ContentModelDescriptor) {
	return {
		providerId: model.providerId,
		modelId: model.modelId,
		displayName: model.displayName,
		outputKind: model.outputKind,
		modes: model.modes.map((mode) => ({
			id: mode.id,
			inputs: mode.inputs.map((input) => ({ ...input, accepts: [...input.accepts] })),
			...(mode.minTotalItems === undefined ? {} : { minTotalItems: mode.minTotalItems }),
			...(mode.maxTotalItems === undefined ? {} : { maxTotalItems: mode.maxTotalItems }),
			...(mode.aspectRatioPolicy ? { aspectRatioPolicy: mode.aspectRatioPolicy } : {}),
			...(mode.audioGeneration ? { audioGeneration: mode.audioGeneration } : {}),
		})),
		aspectRatios: [...model.aspectRatios],
		...(model.durations ? { durations: [...model.durations] } : {}),
		...(model.resolutions ? { resolutions: [...model.resolutions] } : {}),
	};
}

function latestJob(
	jobs: readonly GenerationJob[],
	nodeId: string,
	status: GenerationJob["status"],
): GenerationJob | undefined {
	return [...jobs].reverse().find((job) => job.nodeId === nodeId && job.status === status);
}

function truncateError(error: string): string {
	return error.length <= 500 ? error : `${error.slice(0, 497)}...`;
}
