import type { ContentGenerationService } from "../generation/generation-service";
import type { ContentModelDescriptor } from "../generation/types";
import { applyContentProjectCommands, type ContentProjectCommand } from "../project/commands";
import type { ContentNode, ContentProjectDocument } from "../project/types";
import type { ContentCreationWorkspace } from "../project/workspace";
import {
	contentAgentOperationsAreDestructive,
	parseContentAgentOperations,
} from "./operations";
import { createContentCreationAgentState } from "./state";

const PREVIEW_TTL_MS = 30 * 60 * 1000;
const MAX_PREVIEWS = 50;
const MAX_RUNS = 100;
const MAX_DIRECT_EDIT_COMMANDS = 6;

export interface ContentOperationDiff {
	addedNodeIds: string[];
	removedNodeIds: string[];
	updatedNodeIds: string[];
	addedEdgeCount: number;
	removedEdgeCount: number;
	workflowChanged: boolean;
}

export interface ContentOperationPreview {
	token: string;
	projectId: string;
	expectedRevision: number;
	destructive: boolean;
	diff: ContentOperationDiff;
}

export type ContentEditResult =
	| { kind: "applied"; project: ContentProjectDocument }
	| { kind: "preview"; preview: ContentOperationPreview };

export type ContentRunStatus = "awaiting-confirmation" | "running" | "succeeded" | "failed" | "cancelled";

export interface ContentPreparedRun {
	id: string;
	cwd: string;
	projectId: string;
	expectedRevision: number;
	nodeIds: string[];
	status: ContentRunStatus;
	completedNodeIds: string[];
	failedNodeIds: string[];
	skippedNodeIds: string[];
	error?: string;
}

interface StoredPreview extends ContentOperationPreview {
	cwd: string;
	commands: ContentProjectCommand[];
	createdAt: number;
}

export class ContentCreationAgentService {
	private readonly previews = new Map<string, StoredPreview>();
	private readonly runs = new Map<string, ContentPreparedRun>();
	private readonly runListeners = new Set<() => void>();

	constructor(
		private readonly workspace: ContentCreationWorkspace,
		private readonly getGenerationService: () => ContentGenerationService,
	) {}

	async inspect(cwd: string) {
		const project = await this.workspace.load(cwd);
		return createContentCreationAgentState(project, this.listModels());
	}

	async apply(
		cwd: string,
		operations: readonly unknown[],
		expectedRevision?: number,
	): Promise<ContentProjectDocument> {
		const project = await this.workspace.load(cwd);
		const commands = parseContentAgentOperations(project, operations);
		if (contentAgentOperationsAreDestructive(commands)) {
			throw new Error("destructive operations require an operation preview and user confirmation");
		}
		return await this.workspace.dispatch(cwd, commands, expectedRevision);
	}

	async edit(
		cwd: string,
		operations: readonly unknown[],
		expectedRevision?: number,
	): Promise<ContentEditResult> {
		this.prunePreviews();
		const project = await this.workspace.load(cwd);
		assertExpectedRevision(project, expectedRevision);
		const commands = parseContentAgentOperations(project, operations);
		if (contentAgentOperationsAreDestructive(commands) || commands.length > MAX_DIRECT_EDIT_COMMANDS) {
			return { kind: "preview", preview: this.storePreview(cwd, project, commands) };
		}
		return {
			kind: "applied",
			project: await this.workspace.dispatch(cwd, commands, project.revision),
		};
	}

	async preview(
		cwd: string,
		operations: readonly unknown[],
		expectedRevision?: number,
	): Promise<ContentOperationPreview> {
		this.prunePreviews();
		const project = await this.workspace.load(cwd);
		assertExpectedRevision(project, expectedRevision);
		const commands = parseContentAgentOperations(project, operations);
		return this.storePreview(cwd, project, commands);
	}

	private storePreview(
		cwd: string,
		project: ContentProjectDocument,
		commands: ContentProjectCommand[],
	): ContentOperationPreview {
		const next = applyContentProjectCommands(project, commands);
		const preview: StoredPreview = {
			token: crypto.randomUUID(),
			cwd,
			projectId: project.projectId,
			expectedRevision: project.revision,
			destructive: contentAgentOperationsAreDestructive(commands),
			diff: createOperationDiff(project, next),
			commands,
			createdAt: Date.now(),
		};
		this.previews.set(preview.token, preview);
		return publicPreview(preview);
	}

	async commitPreview(token: string): Promise<ContentProjectDocument> {
		this.prunePreviews();
		const preview = this.previews.get(token);
		if (!preview) throw new Error("operation preview expired or was not found");
		this.previews.delete(token);
		return await this.workspace.dispatch(preview.cwd, preview.commands, preview.expectedRevision);
	}

	async prepareRun(cwd: string, requestedNodeIds?: readonly string[], expectedRevision?: number): Promise<ContentPreparedRun> {
		this.pruneRuns();
		const project = await this.workspace.load(cwd);
		if (expectedRevision !== undefined && project.revision !== expectedRevision) {
			throw new Error(`project revision conflict: expected ${expectedRevision}, actual ${project.revision}`);
		}
		const candidates = resolveRunNodes(project, requestedNodeIds);
		if (candidates.length === 0) throw new Error("no executable image or video generation nodes were selected");
		const run: ContentPreparedRun = {
			id: crypto.randomUUID(),
			cwd,
			projectId: project.projectId,
			expectedRevision: project.revision,
			nodeIds: topologicalNodeOrder(project, candidates.map((node) => node.id)),
			status: "awaiting-confirmation",
			completedNodeIds: [],
			failedNodeIds: [],
			skippedNodeIds: [],
		};
		this.runs.set(run.id, run);
		this.emitRunChange();
		return cloneRun(run);
	}

	getRun(runId: string): ContentPreparedRun | null {
		const run = this.runs.get(runId);
		return run ? cloneRun(run) : null;
	}

	subscribeRuns(listener: () => void): () => void {
		this.runListeners.add(listener);
		return () => this.runListeners.delete(listener);
	}

	async startRun(runId: string): Promise<void> {
		const run = this.runs.get(runId);
		if (!run) throw new Error(`content run not found: ${runId}`);
		if (run.status !== "awaiting-confirmation") return;
		const project = await this.workspace.load(run.cwd);
		if (project.revision !== run.expectedRevision) {
			throw new Error(`project revision conflict: expected ${run.expectedRevision}, actual ${project.revision}`);
		}
		run.status = "running";
		this.emitRunChange();
		void this.executeRun(run).catch((error: unknown) => {
			run.status = "failed";
			run.error = error instanceof Error ? error.message : String(error);
			this.emitRunChange();
		});
	}

	cancelRun(runId: string): void {
		const run = this.runs.get(runId);
		if (!run || run.status === "succeeded" || run.status === "failed") return;
		run.status = "cancelled";
		this.emitRunChange();
	}

	private async executeRun(run: ContentPreparedRun): Promise<void> {
		const generation = this.getGenerationService();
		const selected = new Set(run.nodeIds);
		for (const nodeId of run.nodeIds) {
			if (run.status === "cancelled") return;
			const project = await this.workspace.load(run.cwd);
			const blockedSources = new Set([...run.failedNodeIds, ...run.skippedNodeIds]);
			const blocked = project.graph.edges.some(
				(edge) => edge.target === nodeId && selected.has(edge.source) && blockedSources.has(edge.source),
			);
			if (blocked) {
				run.skippedNodeIds.push(nodeId);
				this.emitRunChange();
				continue;
			}
			try {
				await generation.runNode(run.cwd, nodeId);
				run.completedNodeIds.push(nodeId);
			} catch {
				run.failedNodeIds.push(nodeId);
			}
			this.emitRunChange();
		}
		if (run.status === "cancelled") return;
		run.status = run.failedNodeIds.length > 0 ? "failed" : "succeeded";
		this.emitRunChange();
	}

	private listModels(): ContentModelDescriptor[] {
		return this.getGenerationService().listModels();
	}

	private prunePreviews(): void {
		const cutoff = Date.now() - PREVIEW_TTL_MS;
		for (const [token, preview] of this.previews) {
			if (preview.createdAt < cutoff) this.previews.delete(token);
		}
		while (this.previews.size >= MAX_PREVIEWS) {
			const oldest = this.previews.keys().next().value;
			if (typeof oldest !== "string") break;
			this.previews.delete(oldest);
		}
	}

	private pruneRuns(): void {
		while (this.runs.size >= MAX_RUNS) {
			const completed = [...this.runs].find(([, run]) =>
				["succeeded", "failed", "cancelled"].includes(run.status),
			);
			if (!completed) throw new Error("too many active content generation runs");
			this.runs.delete(completed[0]);
		}
	}

	private emitRunChange(): void {
		for (const listener of this.runListeners) listener();
	}
}

function assertExpectedRevision(project: ContentProjectDocument, expectedRevision?: number): void {
	if (expectedRevision !== undefined && project.revision !== expectedRevision) {
		throw new Error(`project revision conflict: expected ${expectedRevision}, actual ${project.revision}`);
	}
}

function createOperationDiff(current: ContentProjectDocument, next: ContentProjectDocument): ContentOperationDiff {
	const currentNodes = new Map(current.graph.nodes.map((node) => [node.id, node]));
	const nextNodes = new Map(next.graph.nodes.map((node) => [node.id, node]));
	const currentEdgeIds = new Set(current.graph.edges.map((edge) => edge.id));
	const nextEdgeIds = new Set(next.graph.edges.map((edge) => edge.id));
	return {
		addedNodeIds: [...nextNodes.keys()].filter((id) => !currentNodes.has(id)),
		removedNodeIds: [...currentNodes.keys()].filter((id) => !nextNodes.has(id)),
		updatedNodeIds: [...nextNodes.entries()].flatMap(([id, node]) => {
			const previous = currentNodes.get(id);
			return previous && JSON.stringify(previous) !== JSON.stringify(node) ? [id] : [];
		}),
		addedEdgeCount: next.graph.edges.filter((edge) => !currentEdgeIds.has(edge.id)).length,
		removedEdgeCount: current.graph.edges.filter((edge) => !nextEdgeIds.has(edge.id)).length,
		workflowChanged: JSON.stringify(current.workflow) !== JSON.stringify(next.workflow),
	};
}

function resolveRunNodes(project: ContentProjectDocument, requestedNodeIds?: readonly string[]): ContentNode[] {
	const requested = requestedNodeIds?.length ? new Set(requestedNodeIds) : null;
	if (requested) {
		for (const nodeId of requested) {
			if (!project.graph.nodes.some((node) => node.id === nodeId)) throw new Error(`node not found: ${nodeId}`);
		}
	}
	return project.graph.nodes.filter(
		(node) =>
			(node.kind === "image-generator" || node.kind === "video-generator") &&
			(requested ? requested.has(node.id) : node.status !== "succeeded"),
	);
}

function topologicalNodeOrder(project: ContentProjectDocument, nodeIds: readonly string[]): string[] {
	const selected = new Set(nodeIds);
	const indegree = new Map(nodeIds.map((id) => [id, 0]));
	for (const edge of project.graph.edges) {
		if (selected.has(edge.source) && selected.has(edge.target)) {
			indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
		}
	}
	const queue = nodeIds.filter((id) => indegree.get(id) === 0);
	const ordered: string[] = [];
	while (queue.length > 0) {
		const id = queue.shift();
		if (!id) continue;
		ordered.push(id);
		for (const edge of project.graph.edges) {
			if (edge.source !== id || !selected.has(edge.target)) continue;
			const next = (indegree.get(edge.target) ?? 1) - 1;
			indegree.set(edge.target, next);
			if (next === 0) queue.push(edge.target);
		}
	}
	if (ordered.length !== nodeIds.length) throw new Error("selected generation nodes contain a dependency cycle");
	return ordered;
}

function publicPreview(preview: StoredPreview): ContentOperationPreview {
	return {
		token: preview.token,
		projectId: preview.projectId,
		expectedRevision: preview.expectedRevision,
		destructive: preview.destructive,
		diff: structuredClone(preview.diff),
	};
}

function cloneRun(run: ContentPreparedRun): ContentPreparedRun {
	return structuredClone(run);
}
