import type { ContentGenerationService } from "../generation/generation-service";
import { ContentGenerationIntentError } from "../generation/generation-intent";
import type { ContentModelDescriptor } from "../generation/types";
import { planIncrementalContentGraphLayout } from "../node/incremental-graph-layout";
import { applyContentProjectCommands, type ContentProjectCommand } from "../project/commands";
import type { ContentNode, ContentProjectDocument } from "../project/types";
import type { ContentCreationWorkspace } from "../project/workspace";
import { parseContentAgentOperations } from "./operations";
import { createContentCreationAgentState } from "./state";

const MAX_RUNS = 100;

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

export class ContentCreationAgentService {
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

	async edit(
		cwd: string,
		operations: readonly unknown[],
		expectedRevision?: number,
	): Promise<ContentProjectDocument> {
		const project = await this.workspace.load(cwd);
		assertExpectedRevision(project, expectedRevision);
		const commands = parseContentAgentOperations(project, operations, this.listModels());
		const preview = applyContentProjectCommands(project, commands);
		const layout = planIncrementalContentGraphLayout(project, preview, addedNodeIds(commands));
		const layoutCommands: ContentProjectCommand[] = layout.placements.map(({ nodeId, position }) => ({
			type: "node.layout",
			nodeId,
			position,
		}));
		return await this.workspace.dispatch(cwd, [...commands, ...layoutCommands], project.revision);
	}

	async prepareRun(cwd: string, requestedNodeIds?: readonly string[], expectedRevision?: number): Promise<ContentPreparedRun> {
		this.pruneRuns();
		const project = await this.workspace.load(cwd);
		if (expectedRevision !== undefined && project.revision !== expectedRevision) {
			throw new Error(`project revision conflict: expected ${expectedRevision}, actual ${project.revision}`);
		}
		const candidates = resolveRunNodes(project, requestedNodeIds);
		if (candidates.length === 0) throw new Error("no executable image or video generation nodes were selected");
		const state = createContentCreationAgentState(project, this.listModels());
		const candidateIds = new Set(candidates.map((node) => node.id));
		const blockingIssues = state.analysis.issues.filter(
			(issue) =>
				issue.severity === "error" &&
				(!issue.nodeId || candidateIds.has(issue.nodeId)) &&
				RUN_BLOCKING_DIAGNOSTIC_CODES.has(issue.code),
		);
		if (blockingIssues.length > 0) {
			throw new ContentGenerationIntentError(
				"content generation plan is not ready",
				"generation-plan-not-ready",
				{ issues: blockingIssues },
			);
		}
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

function addedNodeIds(commands: readonly ContentProjectCommand[]): Set<string> {
	return new Set(
		commands.flatMap((command) => {
			if (command.type === "node.add" && command.node.id) return [command.node.id];
			if (command.type === "node.duplicate" && command.id) return [command.id];
			return [];
		}),
	);
}

function resolveRunNodes(project: ContentProjectDocument, requestedNodeIds?: readonly string[]): ContentNode[] {
	const requested = requestedNodeIds?.length ? new Set(requestedNodeIds) : null;
	if (requested) {
		for (const nodeId of requested) {
			if (!project.graph.nodes.some((node) => node.id === nodeId)) throw new Error(`node not found: ${nodeId}`);
		}
	}
	if (requested) {
		let changed = true;
		while (changed) {
			changed = false;
			for (const edge of project.graph.edges) {
				if (!requested.has(edge.target) || requested.has(edge.source)) continue;
				const source = project.graph.nodes.find((node) => node.id === edge.source);
				if (!source || (source.kind !== "image-generator" && source.kind !== "video-generator")) continue;
				if (source.status === "succeeded" && source.data.assetId) continue;
				requested.add(source.id);
				changed = true;
			}
		}
	}
	return project.graph.nodes.filter(
		(node) =>
			(node.kind === "image-generator" || node.kind === "video-generator") &&
			(requested ? requested.has(node.id) : node.status !== "succeeded"),
	);
}

const RUN_BLOCKING_DIAGNOSTIC_CODES = new Set([
	"asset-connection-unbound",
	"generation-prompt-missing",
	"generation-provider-unavailable",
	"generation-source-asset-missing",
	"selected-model-unavailable",
	"generation-source-role-missing",
	"generation-inputs-incompatible",
]);

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

function cloneRun(run: ContentPreparedRun): ContentPreparedRun {
	return structuredClone(run);
}
