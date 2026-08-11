import type { ContentModelDescriptor } from "../generation/types";
import { resolveConfiguredContentGeneration } from "../generation/generation-intent";
import { resolveContentPrompt, listConnectedPromptSources } from "../node/prompt-sources";
import type { ContentEdge, ContentNode, ContentProjectDocument } from "../project/types";

export type ContentWorkflowReadinessStatus =
	| "empty"
	| "incomplete"
	| "ready"
	| "running"
	| "partial"
	| "completed";

export interface ContentWorkflowAnalysisIssue {
	code: string;
	severity: "error" | "warning" | "info";
	message: string;
	nodeId?: string;
	edgeId?: string;
	retryable?: boolean;
}

export interface ContentSemanticConnection {
	id: string;
	fromNodeId: string;
	fromOutput: "prompt" | "image" | "video" | "media-collection" | "deliverable";
	toNodeId: string;
	toInput: string;
}

export interface ContentWorkflowAnalysis {
	status: ContentWorkflowReadinessStatus;
	connections: ContentSemanticConnection[];
	components: string[][];
	runnableNodeIds: string[];
	blockedNodeIds: string[];
	orphanNodeIds: string[];
	issues: ContentWorkflowAnalysisIssue[];
}

export function analyzeContentWorkflow(
	project: ContentProjectDocument,
	models: readonly ContentModelDescriptor[],
	baseIssues: readonly ContentWorkflowAnalysisIssue[] = [],
): ContentWorkflowAnalysis {
	const connections = project.graph.edges.flatMap((edge) => {
		const semantic = semanticConnection(project, edge);
		return semantic ? [semantic] : [];
	});
	const issues = [...baseIssues, ...diagnoseGraph(project, models)];
	const generatorNodes = project.graph.nodes.filter(isGeneratorNode);
	const runnableNodeIds = generatorNodes.flatMap((node) =>
		isGeneratorRunnable(project, node, models) ? [node.id] : [],
	);
	const runnable = new Set(runnableNodeIds);
	const blockedNodeIds = generatorNodes.filter((node) => !runnable.has(node.id)).map((node) => node.id);
	const connectedNodeIds = new Set(project.graph.edges.flatMap((edge) => [edge.source, edge.target]));
	const deliverableNodeIds = new Set(project.workflow.deliverables.map((deliverable) => deliverable.fromNode));
	const orphanNodeIds = project.graph.nodes
		.filter((node) => !connectedNodeIds.has(node.id) && !deliverableNodeIds.has(node.id))
		.map((node) => node.id);

	return {
		status: workflowStatus(project, generatorNodes, issues),
		connections,
		components: connectedComponents(project),
		runnableNodeIds,
		blockedNodeIds,
		orphanNodeIds,
		issues,
	};
}

function diagnoseGraph(
	project: ContentProjectDocument,
	models: readonly ContentModelDescriptor[],
): ContentWorkflowAnalysisIssue[] {
	const issues: ContentWorkflowAnalysisIssue[] = [];
	const deliverableNodeIds = new Set(project.workflow.deliverables.map((deliverable) => deliverable.fromNode));
	const connectedNodeIds = new Set(project.graph.edges.flatMap((edge) => [edge.source, edge.target]));
	for (const node of project.graph.nodes) {
		if (!connectedNodeIds.has(node.id) && !deliverableNodeIds.has(node.id) && project.graph.nodes.length > 1) {
			issues.push({
				code: "orphan-node",
				severity: "warning",
				nodeId: node.id,
				message: "Node is isolated from the workflow and is not a declared deliverable.",
			});
		}
		if (
			isGeneratorNode(node) &&
			!deliverableNodeIds.has(node.id) &&
			!project.graph.edges.some((edge) => edge.source === node.id)
		) {
			issues.push({
				code: "generator-output-unused",
				severity: "warning",
				nodeId: node.id,
				message: "Generator output is neither connected nor declared as a deliverable.",
			});
		}
		if (isGeneratorNode(node) && models.some((model) => model.outputKind === (node.kind === "image-generator" ? "image" : "video"))) {
			const resolution = resolveConfiguredContentGeneration(project, node, models);
			if (!resolution.ok && resolution.reason === "source-role-missing") {
				issues.push({
					code: "generation-source-role-missing",
					severity: "error",
					nodeId: node.id,
					message: "Generation media sources must declare an explicit business role.",
				});
			} else if (!resolution.ok && resolution.reason === "source-asset-missing") {
				issues.push({
					code: "generation-source-asset-missing",
					severity: "error",
					nodeId: node.id,
					message: "Generation input references an asset that no longer exists in the project.",
				});
			} else if (!resolution.ok && resolution.reason === "inputs-incompatible") {
				issues.push({
					code: "generation-inputs-incompatible",
					severity: "error",
					nodeId: node.id,
					message: "Generation mode and media roles do not match any configured model capability.",
				});
			}
		}
	}
	for (const edge of project.graph.edges) {
		const source = project.graph.nodes.find((node) => node.id === edge.source);
		const target = project.graph.nodes.find((node) => node.id === edge.target);
		if (source?.kind !== "asset" || !target || !isGeneratorNode(target)) continue;
		const hasBinding = (target.data.inputs ?? []).some((binding) => binding.sourceNodeId === source.id);
		if (!hasBinding) {
			issues.push({
				code: "asset-connection-unbound",
				severity: "error",
				nodeId: target.id,
				edgeId: edge.id,
				message: "Connected asset collection has no selected asset bindings for this generator.",
			});
		}
	}
	return issues;
}

function workflowStatus(
	project: ContentProjectDocument,
	generators: readonly ContentNode[],
	issues: readonly ContentWorkflowAnalysisIssue[],
): ContentWorkflowReadinessStatus {
	if (project.graph.nodes.length === 0) return "empty";
	if (project.jobs.some((job) => job.status === "queued" || job.status === "running")) return "running";
	const succeeded = generators.filter((node) => node.status === "succeeded").length;
	const failed = generators.filter((node) => node.status === "failed").length;
	if (succeeded > 0 && failed > 0) return "partial";
	if (
		generators.length > 0 &&
		succeeded === generators.length &&
		project.workflow.deliverables.length > 0 &&
		!issues.some((issue) => issue.severity === "error")
	) {
		return "completed";
	}
	if (
		generators.length === 0 ||
		project.workflow.deliverables.length === 0 ||
		issues.some((issue) => issue.severity === "error" || issue.code === "orphan-node")
	) {
		return "incomplete";
	}
	return "ready";
}

function isGeneratorRunnable(
	project: ContentProjectDocument,
	node: ContentNode,
	models: readonly ContentModelDescriptor[],
): boolean {
	if (!isGeneratorNode(node)) return false;
	if (!resolveContentPrompt(listConnectedPromptSources(project, node.id), node.data)) return false;
	return resolveConfiguredContentGeneration(project, node, models).ok;
}

function isGeneratorNode(node: ContentNode): boolean {
	return node.kind === "image-generator" || node.kind === "video-generator";
}

function connectedComponents(project: ContentProjectDocument): string[][] {
	const neighbors = new Map(project.graph.nodes.map((node) => [node.id, new Set<string>()]));
	for (const edge of project.graph.edges) {
		neighbors.get(edge.source)?.add(edge.target);
		neighbors.get(edge.target)?.add(edge.source);
	}
	const remaining = new Set(neighbors.keys());
	const components: string[][] = [];
	while (remaining.size > 0) {
		const first = remaining.values().next().value;
		if (typeof first !== "string") break;
		const pending = [first];
		const component: string[] = [];
		while (pending.length > 0) {
			const nodeId = pending.pop();
			if (!nodeId || !remaining.delete(nodeId)) continue;
			component.push(nodeId);
			pending.push(...(neighbors.get(nodeId) ?? []));
		}
		components.push(component);
	}
	return components;
}

function semanticConnection(project: ContentProjectDocument, edge: ContentEdge): ContentSemanticConnection | null {
	const source = project.graph.nodes.find((node) => node.id === edge.source);
	const target = project.graph.nodes.find((node) => node.id === edge.target);
	if (!source || !target) return null;
	const fromOutput = semanticOutput(source);
	const toInput = semanticInput(target, edge);
	return fromOutput && toInput
		? { id: edge.id, fromNodeId: source.id, fromOutput, toNodeId: target.id, toInput }
		: null;
}

function semanticOutput(node: ContentNode): ContentSemanticConnection["fromOutput"] | null {
	if (node.kind === "prompt") return "prompt";
	if (node.kind === "image-generator") return "image";
	if (node.kind === "video-generator") return "video";
	if (node.kind === "asset") return "media-collection";
	if (node.kind === "output") return "deliverable";
	return null;
}

function semanticInput(
	node: ContentNode,
	edge: ContentEdge,
): ContentSemanticConnection["toInput"] | null {
	const targetHandle = edge.targetHandle;
	if (node.kind === "prompt" && targetHandle === "media") return "mediaSources";
	if (node.kind === "image-generator" && targetHandle === "prompt") return "promptSources";
	if (node.kind === "video-generator" && targetHandle === "prompt") return "promptSources";
	if (
		(node.kind === "image-generator" || node.kind === "video-generator") &&
		targetHandle !== "prompt" &&
		edge.role
	) return edge.role;
	if (node.kind === "image-generator" && targetHandle === "reference") return "referenceImages";
	if (node.kind === "video-generator" && targetHandle === "image") return "unassignedImage";
	if (node.kind === "video-generator" && targetHandle === "video") return "unassignedVideo";
	if (node.kind === "video-generator" && targetHandle === "audio") return "unassignedAudio";
	if (node.kind === "output" && targetHandle === "content") return "contentSources";
	return null;
}
