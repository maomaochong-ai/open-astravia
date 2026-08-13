import type { ContentModelDescriptor } from "../generation/types";
import { CONTENT_NODE_DEFINITIONS } from "../node/definitions";
import { listConnectedPromptSources, resolveContentPrompt } from "../node/prompt-sources";
import { serializeContentProject } from "../project/persistence";
import type { ContentNode, ContentProjectDocument, GenerationJob } from "../project/types";
import { contentPromptTextFromData } from "../node/prompt-document";
import { analyzeVideoPromptMethod, VIDEO_PROMPT_PLAN_FIELD_GUIDANCE } from "./generation-prompt-plan";
import { contentVideoShotMethod, inferContentVideoShotStrategy } from "./video-shot-methods";
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
		videoPlans: project.graph.nodes
			.filter((node) => node.kind === "video-generator")
			.map((node) => videoPlanForAgent(project, node)),
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
	const connectedPromptSources = listConnectedPromptSources(project, node.id);
	const prompt = resolveContentPrompt(connectedPromptSources, node.data);
	const composedPromptSourceIds = new Set(
		node.data.promptDocument?.segments.flatMap((segment) =>
			segment.type === "prompt-reference" ? [segment.sourceNodeId] : [],
		) ?? [],
	);
	const shadowedPromptSourceIds = connectedPromptSources
		.map(({ nodeId }) => nodeId)
		.filter((nodeId) => !composedPromptSourceIds.has(nodeId));
	if (node.kind === "video-generator" && contentPromptTextFromData(node.data) && shadowedPromptSourceIds.length > 0) {
		diagnostics.push({
			code: "connected-prompt-source-shadowed",
			severity: "warning",
			nodeId: node.id,
			message: "Connected Prompt nodes are not part of the generator's effective prompt composition.",
			retryable: true,
			details: {
				shadowedPromptSourceNodeIds: shadowedPromptSourceIds,
				recommendedOperation: "configure_video_shot",
			},
		});
	}
	if (!prompt) {
		diagnostics.push({
			code: "generation-prompt-missing",
			severity: "error",
			nodeId: node.id,
			message: "Generation node has no effective prompt.",
		});
	} else if (node.kind === "video-generator") {
		const strategy = inferContentVideoShotStrategy(node.data.modeId, videoSourceRoles(project, node.id));
		const issues = analyzeVideoPromptMethod(prompt, strategy);
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
		diagnoseVideoStrategyPromptContracts(project, node, prompt, diagnostics);
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

function videoPlanForAgent(project: ContentProjectDocument, node: ContentNode) {
	const sourceRoles = videoSourceRoles(project, node.id);
	const strategy = inferContentVideoShotStrategy(node.data.modeId, sourceRoles);
	const method = strategy ? contentVideoShotMethod(strategy) : undefined;
	return {
		nodeId: node.id,
		strategy: strategy ?? "unconfigured",
		modeId: node.data.modeId ?? null,
		sourceRoles,
		method: method
			? {
				promptPlanKind: method.promptPlanKind,
				description: method.description,
				inputContract: method.inputContract,
			}
			: null,
	};
}

function videoSourceRoles(project: ContentProjectDocument, nodeId: string): string[] {
	return project.graph.edges
		.filter((edge) => edge.target === nodeId && edge.targetHandle !== "prompt")
		.flatMap((edge) => edge.role ? [edge.role] : []);
}

function diagnoseVideoStrategyPromptContracts(
	project: ContentProjectDocument,
	node: ContentNode,
	prompt: string,
	diagnostics: ContentAgentDiagnostic[],
): void {
	const frameEdges = project.graph.edges.filter(
		(edge) => edge.target === node.id && (edge.role === "firstFrame" || edge.role === "lastFrame"),
	);
	if (frameEdges.length > 0) {
		const prompts = frameEdges.map((edge) => {
			const source = project.graph.nodes.find((candidate) => candidate.id === edge.source);
			return {
				role: edge.role,
				nodeId: edge.source,
				prompt: source ? contentPromptTextFromData(source.data) : "",
			};
		});
		for (const frame of prompts) {
			const expected = frame.role === "firstFrame" ? "first" : "last";
			if (!new RegExp(`keyframe phase\\s*:\\s*${expected} frame`, "i").test(frame.prompt)) {
				diagnostics.push({
					code: "video-keyframe-prompt-contract-missing",
					severity: "warning",
					nodeId: frame.nodeId,
					message: `${frame.role} should use a static image-keyframe prompt plan instead of video directing language.`,
					retryable: true,
					details: { videoNodeId: node.id, role: frame.role, recommendedPromptPlanKind: "image-keyframe" },
				});
			}
		}
		if (
			frameEdges.some((edge) => edge.role === "lastFrame") &&
			prompts.length === 2 &&
			prompts[0]?.prompt &&
			prompts[0].prompt === prompts[1]?.prompt
		) {
			diagnostics.push({
				code: "video-keyframe-prompts-reused",
				severity: "warning",
				nodeId: node.id,
				message: "First and last frames reuse the same prompt instead of describing distinct visible states.",
				retryable: true,
			});
		}
	}
	if (node.data.modeId === "reference-to-video" && !/^Reference manifest:/i.test(prompt)) {
		diagnostics.push({
			code: "video-reference-manifest-missing",
			severity: "warning",
			nodeId: node.id,
			message: "Omni-reference generation should assign every media input a stable alias, semantic role, and instruction.",
			retryable: true,
			details: { recommendedOperation: "configure_video_shot" },
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
