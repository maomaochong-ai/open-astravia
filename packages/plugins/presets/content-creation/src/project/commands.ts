import type {
	CanvasPosition,
	ContentAsset,
	ContentEdge,
	GenerationJob,
	ContentNode,
	ContentNodeKind,
	ContentProjectDocument,
	ContentWorkflow,
	TimelineClip,
} from "./types";
import { contentNodeDataEqual } from "../node/content-node-data-equal";
import { resolveContentConnectionResult } from "../node/connections";
import { createDefaultContentNodeData } from "../node/definitions";
import { getContentNodeSize } from "../node/geometry";
import { createContentPromptDocument } from "../node/prompt-document";
import { getDefaultNodePurpose } from "./node-semantics";

export type ContentProjectCommand =
	| { type: "workflow.update"; workflow: Partial<ContentWorkflow> }
	| {
			type: "node.add";
			node: {
				id?: string;
				kind: ContentNodeKind;
				name?: string;
				purpose?: string;
				position: CanvasPosition;
				data?: ContentNode["data"];
			};
	  }
	| { type: "node.rename"; nodeId: string; name: string }
	| { type: "node.set-purpose"; nodeId: string; purpose: string }
	| { type: "node.update"; nodeId: string; data: ContentNode["data"] }
	| { type: "node.move"; nodeId: string; position: CanvasPosition }
	| { type: "node.resize"; nodeId: string; width: number; height: number; position?: CanvasPosition }
	| { type: "node.lock"; nodeId: string; locked: boolean }
	| { type: "node.duplicate"; nodeId: string; id?: string; position?: CanvasPosition }
	| {
			type: "node.bind-assets";
			sourceNodeId: string;
			targetNodeId: string;
			assetIds: string[];
			targetHandle: string;
			slotId: string;
	  }
	| { type: "node.delete"; nodeId: string }
	| { type: "edge.connect"; id?: string; source: string; target: string; sourceHandle?: string; targetHandle?: string }
	| { type: "edge.delete"; edgeId: string }
	| { type: "asset.add"; asset: ContentAsset }
	| {
			type: "job.start";
			job: { id: string; nodeId: string; providerId: string; modelId: string; outputAssetId: string };
	  }
	| {
			type: "job.attach";
			jobId: string;
			execution: NonNullable<GenerationJob["execution"]>;
			status: "queued" | "running";
			progress?: number;
	  }
	| { type: "job.update"; jobId: string; status: "queued" | "running"; progress?: number }
	| { type: "job.succeed"; jobId: string; asset: ContentAsset }
	| { type: "job.fail"; jobId: string; error: string; errorCode?: GenerationJob["errorCode"] }
	| {
			type: "timeline.clip.add";
			clip: Omit<TimelineClip, "id"> & { id?: string };
	  }
	| { type: "timeline.clip.move"; clipId: string; trackId: string; start: number }
	| { type: "timeline.clip.trim"; clipId: string; sourceIn: number; duration: number }
	| { type: "timeline.clip.delete"; clipId: string };

export class ContentProjectCommandError extends Error {
	constructor(
		message: string,
		readonly code = "invalid-command",
		readonly details?: Record<string, unknown>,
	) {
		super(message);
	}
}

function assertFiniteNonNegative(value: number, field: string): void {
	if (!Number.isFinite(value) || value < 0) throw new ContentProjectCommandError(`${field} must be a finite non-negative number`);
}

function assertPosition(position: CanvasPosition): void {
	if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
		throw new ContentProjectCommandError("node position must contain finite coordinates");
	}
}

function assertNodeSize(width: number, height: number): void {
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
		throw new ContentProjectCommandError("node size must contain positive finite dimensions");
	}
}

function findNode(project: ContentProjectDocument, nodeId: string): ContentNode {
	const node = project.graph.nodes.find((candidate) => candidate.id === nodeId);
	if (!node) throw new ContentProjectCommandError(`node not found: ${nodeId}`);
	return node;
}

function findTrack(project: ContentProjectDocument, trackId: string) {
	const track = project.timeline.tracks.find((candidate) => candidate.id === trackId);
	if (!track) throw new ContentProjectCommandError(`track not found: ${trackId}`);
	return track;
}

function findClip(project: ContentProjectDocument, clipId: string) {
	for (const track of project.timeline.tracks) {
		const clip = track.clips.find((candidate) => candidate.id === clipId);
		if (clip) return { track, clip };
	}
	throw new ContentProjectCommandError(`clip not found: ${clipId}`);
}

function findJob(project: ContentProjectDocument, jobId: string): GenerationJob {
	const job = project.jobs.find((candidate) => candidate.id === jobId);
	if (!job) throw new ContentProjectCommandError(`job not found: ${jobId}`);
	return job;
}

function assertWorkflow(project: ContentProjectDocument): void {
	if (!project.workflow.title.trim()) throw new ContentProjectCommandError("workflow title must not be empty");
	for (const deliverable of project.workflow.deliverables) {
		if (!project.graph.nodes.some((node) => node.id === deliverable.fromNode)) {
			throw new ContentProjectCommandError(`deliverable node not found: ${deliverable.fromNode}`);
		}
	}
}

function applyCommand(project: ContentProjectDocument, command: ContentProjectCommand, now: string): void {
	switch (command.type) {
		case "workflow.update": {
			if (command.workflow.title !== undefined) project.workflow.title = command.workflow.title;
			if (command.workflow.objective !== undefined) project.workflow.objective = command.workflow.objective;
			if (command.workflow.deliverables !== undefined) {
				project.workflow.deliverables = structuredClone(command.workflow.deliverables);
			}
			return;
		}
		case "node.add": {
			assertPosition(command.node.position);
			const id = command.node.id ?? crypto.randomUUID();
			if (project.graph.nodes.some((node) => node.id === id)) {
				throw new ContentProjectCommandError(`node already exists: ${id}`);
			}
			const data = createDefaultContentNodeData(command.node.kind, command.node.data);
			const size = getContentNodeSize(command.node.kind, data.aspectRatio);
			project.graph.nodes.push({
				id,
				kind: command.node.kind,
				name: command.node.name?.trim() || defaultNodeName(project, command.node.kind),
				purpose: command.node.purpose?.trim() || getDefaultNodePurpose(command.node.kind),
				position: command.node.position,
				...size,
				status: "idle",
				data,
			});
			return;
		}
		case "node.rename": {
			const name = command.name.trim();
			if (!name) throw new ContentProjectCommandError("node name must not be empty");
			findNode(project, command.nodeId).name = name;
			return;
		}
		case "node.set-purpose": {
			const purpose = command.purpose.trim();
			if (!purpose) throw new ContentProjectCommandError("node purpose must not be empty");
			findNode(project, command.nodeId).purpose = purpose;
			return;
		}
		case "node.update": {
			const node = findNode(project, command.nodeId);
			const nextData = { ...node.data, ...command.data };
			if (command.data.prompt !== undefined && command.data.promptDocument === undefined) {
				nextData.promptDocument = createContentPromptDocument(nextData);
			}
			node.data = nextData;
			return;
		}
		case "node.move": {
			assertPosition(command.position);
			const node = findNode(project, command.nodeId);
			if (node.locked) throw new ContentProjectCommandError(`node is locked: ${command.nodeId}`);
			node.position = command.position;
			return;
		}
		case "node.resize": {
			assertNodeSize(command.width, command.height);
			const node = findNode(project, command.nodeId);
			if (node.locked) throw new ContentProjectCommandError(`node is locked: ${command.nodeId}`);
			node.width = command.width;
			node.height = command.height;
			if (command.position) {
				assertPosition(command.position);
				node.position = command.position;
			}
			return;
		}
		case "node.lock": {
			findNode(project, command.nodeId).locked = command.locked;
			return;
		}
		case "node.duplicate": {
			const source = findNode(project, command.nodeId);
			const position = command.position ?? { x: source.position.x + 40, y: source.position.y + 40 };
			const id = command.id ?? crypto.randomUUID();
			assertPosition(position);
			if (project.graph.nodes.some((node) => node.id === id)) {
				throw new ContentProjectCommandError(`node already exists: ${id}`);
			}
			project.graph.nodes.push({
				...structuredClone(source),
				id,
				position,
				locked: false,
				status: "idle",
			});
			return;
		}
		case "node.bind-assets": {
			const source = findNode(project, command.sourceNodeId);
			const target = findNode(project, command.targetNodeId);
			if (source.kind !== "asset") {
				throw new ContentProjectCommandError("asset binding source must be an asset node", "asset-binding-source-invalid");
			}
			if (target.kind !== "image-generator" && target.kind !== "video-generator") {
				throw new ContentProjectCommandError(
					"asset binding target must be an image or video generator",
					"asset-binding-target-invalid",
				);
			}
			const sourceAssetIds = new Set(source.data.assetIds ?? []);
			for (const assetId of command.assetIds) {
				if (!sourceAssetIds.has(assetId)) {
					throw new ContentProjectCommandError(
						`asset is not present in source node: ${assetId}`,
						"asset-binding-asset-not-found",
					);
				}
				const asset = project.assets.find((candidate) => candidate.id === assetId);
				if (!asset || !assetKindMatchesSlot(asset.kind, command.slotId)) {
					throw new ContentProjectCommandError(
						`asset is incompatible with ${command.slotId}: ${assetId}`,
						"asset-binding-type-mismatch",
					);
				}
			}
			applyCommand(
				project,
				{
					type: "edge.connect",
					source: source.id,
					target: target.id,
					targetHandle: command.targetHandle,
				},
				now,
			);
			const inputs = [...(target.data.inputs ?? [])];
			for (const assetId of command.assetIds) {
				if (
					inputs.some(
						(binding) =>
							binding.assetId === assetId &&
							binding.sourceNodeId === source.id &&
							binding.slotId === command.slotId,
					)
				) {
					continue;
				}
				inputs.push({ id: crypto.randomUUID(), assetId, slotId: command.slotId, sourceNodeId: source.id });
			}
			target.data.inputs = inputs;
			return;
		}
		case "node.delete": {
			findNode(project, command.nodeId);
			project.graph.nodes = project.graph.nodes.filter((node) => node.id !== command.nodeId);
			project.graph.edges = project.graph.edges.filter(
				(edge) => edge.source !== command.nodeId && edge.target !== command.nodeId,
			);
			for (const track of project.timeline.tracks) {
				track.clips = track.clips.filter((clip) => clip.sourceNodeId !== command.nodeId);
			}
			project.jobs = project.jobs.filter((job) => job.nodeId !== command.nodeId);
			project.workflow.deliverables = project.workflow.deliverables.filter(
				(deliverable) => deliverable.fromNode !== command.nodeId,
			);
			return;
		}
		case "edge.connect": {
			if (command.source === command.target) throw new ContentProjectCommandError("a node cannot connect to itself");
			if (command.id && project.graph.edges.some((edge) => edge.id === command.id)) {
				throw new ContentProjectCommandError(`edge already exists: ${command.id}`);
			}
			const sourceNode = findNode(project, command.source);
			const targetNode = findNode(project, command.target);
			const resolution = resolveContentConnectionResult(
				project,
				sourceNode,
				targetNode,
				command.sourceHandle,
				command.targetHandle,
			);
			if (!resolution.ok) {
				throw new ContentProjectCommandError(
					connectionFailureMessage(resolution.code, resolution.cyclePath),
					`connection-${resolution.code}`,
					{
						sourceNodeId: sourceNode.id,
						targetNodeId: targetNode.id,
						...(resolution.cyclePath ? { cyclePath: resolution.cyclePath } : {}),
						...(resolution.availableSourceHandles
							? { availableSourceHandles: resolution.availableSourceHandles }
							: {}),
						...(resolution.availableTargetHandles
							? { availableTargetHandles: resolution.availableTargetHandles }
							: {}),
					},
				);
			}
			const connection = resolution.connection;
			if (
				project.graph.edges.some(
					(edge) =>
						edge.source === command.source &&
						edge.target === command.target &&
						(edge.sourceHandle ?? connection.sourceHandle) === connection.sourceHandle &&
						(edge.targetHandle ?? connection.targetHandle) === connection.targetHandle,
				)
			)
				return;
			const edge: ContentEdge = {
				id: command.id ?? crypto.randomUUID(),
				source: command.source,
				target: command.target,
				sourceHandle: connection.sourceHandle,
				targetHandle: connection.targetHandle,
			};
			project.graph.edges.push(edge);
			return;
		}
		case "edge.delete": {
			const edge = project.graph.edges.find((candidate) => candidate.id === command.edgeId);
			if (!edge) {
				throw new ContentProjectCommandError(`edge not found: ${command.edgeId}`);
			}
			project.graph.edges = project.graph.edges.filter((edge) => edge.id !== command.edgeId);
			const target = findNode(project, edge.target);
			if (edge.targetHandle === "prompt") {
				if (target.data.promptSourceNodeId === edge.source) target.data.promptSourceNodeId = null;
				if (target.data.promptDocument) {
					target.data.promptDocument = {
						...target.data.promptDocument,
						segments: target.data.promptDocument.segments.filter(
							(segment) => segment.type !== "prompt-reference" || segment.sourceNodeId !== edge.source,
						),
					};
				}
			} else {
				const removedBindingIds = new Set(
					(target.data.inputs ?? [])
						.filter((binding) => binding.sourceNodeId === edge.source)
						.map((binding) => binding.id),
				);
				target.data.inputs = (target.data.inputs ?? []).filter((binding) => !removedBindingIds.has(binding.id));
				if (target.data.promptDocument && removedBindingIds.size > 0) {
					target.data.promptDocument = {
						...target.data.promptDocument,
						segments: target.data.promptDocument.segments.filter(
							(segment) => segment.type !== "asset-reference" || !removedBindingIds.has(segment.bindingId),
						),
					};
				}
			}
			return;
		}
		case "asset.add": {
			if (project.assets.some((asset) => asset.id === command.asset.id)) {
				throw new ContentProjectCommandError(`asset already exists: ${command.asset.id}`);
			}
			project.assets.push(structuredClone(command.asset));
			return;
		}
		case "job.start": {
			const node = findNode(project, command.job.nodeId);
			if (project.jobs.some((job) => job.id === command.job.id)) {
				throw new ContentProjectCommandError(`job already exists: ${command.job.id}`);
			}
			if (project.jobs.some((job) => job.nodeId === node.id && (job.status === "queued" || job.status === "running"))) {
				throw new ContentProjectCommandError(`node already has an active job: ${node.id}`);
			}
			project.jobs.push({
				id: command.job.id,
				nodeId: node.id,
				provider: command.job.providerId,
				model: command.job.modelId,
				status: "queued",
				progress: 0,
				outputAssetId: command.job.outputAssetId,
				createdAt: now,
				updatedAt: now,
			});
			node.status = "queued";
			return;
		}
		case "job.attach": {
			const job = findJob(project, command.jobId);
			if (job.status !== "queued" && job.status !== "running") return;
			job.execution = structuredClone(command.execution);
			job.status = command.status;
			job.progress = normalizeJobProgress(command.progress, job.progress);
			job.updatedAt = now;
			findNode(project, job.nodeId).status = command.status;
			return;
		}
		case "job.update": {
			const job = findJob(project, command.jobId);
			if (job.status !== "queued" && job.status !== "running") return;
			job.status = command.status;
			job.progress = normalizeJobProgress(command.progress, job.progress);
			job.updatedAt = now;
			findNode(project, job.nodeId).status = command.status;
			return;
		}
		case "job.succeed": {
			const job = findJob(project, command.jobId);
			if (project.assets.some((asset) => asset.id === command.asset.id)) {
				throw new ContentProjectCommandError(`asset already exists: ${command.asset.id}`);
			}
			project.assets.push(structuredClone(command.asset));
			job.status = "succeeded";
			job.progress = 1;
			job.assetId = command.asset.id;
			job.error = undefined;
			job.errorCode = undefined;
			job.updatedAt = now;
			const node = findNode(project, job.nodeId);
			node.status = "succeeded";
			node.data.assetId = command.asset.id;
			return;
		}
		case "job.fail": {
			const job = findJob(project, command.jobId);
			job.status = "failed";
			job.progress = 1;
			job.error = command.error;
			job.errorCode = command.errorCode;
			job.updatedAt = now;
			findNode(project, job.nodeId).status = "failed";
			return;
		}
		case "timeline.clip.add": {
			assertFiniteNonNegative(command.clip.start, "clip.start");
			assertFiniteNonNegative(command.clip.sourceIn, "clip.sourceIn");
			if (!Number.isFinite(command.clip.duration) || command.clip.duration <= 0) {
				throw new ContentProjectCommandError("clip.duration must be positive");
			}
			if (!Number.isFinite(command.clip.speed) || command.clip.speed <= 0) {
				throw new ContentProjectCommandError("clip.speed must be positive");
			}
			if (command.clip.sourceNodeId) findNode(project, command.clip.sourceNodeId);
			if (command.clip.assetId && !project.assets.some((asset) => asset.id === command.clip.assetId)) {
				throw new ContentProjectCommandError(`asset not found: ${command.clip.assetId}`);
			}
			if (!command.clip.sourceNodeId && !command.clip.assetId) {
				throw new ContentProjectCommandError("clip requires sourceNodeId or assetId");
			}
			const track = findTrack(project, command.clip.trackId);
			const id = command.clip.id ?? crypto.randomUUID();
			if (project.timeline.tracks.some((candidate) => candidate.clips.some((clip) => clip.id === id))) {
				throw new ContentProjectCommandError(`clip already exists: ${id}`);
			}
			track.clips.push({ ...command.clip, id });
			return;
		}
		case "timeline.clip.move": {
			assertFiniteNonNegative(command.start, "clip.start");
			const found = findClip(project, command.clipId);
			const target = findTrack(project, command.trackId);
			found.clip.start = command.start;
			if (found.track.id !== target.id) {
				found.track.clips = found.track.clips.filter((clip) => clip.id !== command.clipId);
				found.clip.trackId = target.id;
				target.clips.push(found.clip);
			}
			return;
		}
		case "timeline.clip.trim": {
			assertFiniteNonNegative(command.sourceIn, "clip.sourceIn");
			if (!Number.isFinite(command.duration) || command.duration <= 0) {
				throw new ContentProjectCommandError("clip.duration must be positive");
			}
			const { clip } = findClip(project, command.clipId);
			clip.sourceIn = command.sourceIn;
			clip.duration = command.duration;
			return;
		}
		case "timeline.clip.delete": {
			const { track } = findClip(project, command.clipId);
			track.clips = track.clips.filter((clip) => clip.id !== command.clipId);
			return;
		}
	}
}

function connectionFailureMessage(code: string, cyclePath?: readonly string[]): string {
	if (code === "would-create-cycle") {
		return cyclePath?.length
			? `connection would create a cycle: ${cyclePath.join(" -> ")}`
			: "connection would create a cycle";
	}
	if (code === "source-port-not-found") return "connection source port does not exist";
	if (code === "target-port-not-found") return "connection target port does not exist";
	if (code === "type-mismatch") return "connection node port types are incompatible";
	if (code === "target-occupied") return "connection target port is already occupied";
	return "a node cannot connect to itself";
}

function normalizeJobProgress(progress: number | undefined, fallback: number): number {
	if (progress === undefined || !Number.isFinite(progress)) return fallback;
	return Math.max(0, Math.min(1, progress));
}

function assetKindMatchesSlot(kind: ContentAsset["kind"], slotId: string): boolean {
	if (slotId === "firstFrame" || slotId === "referenceImages") return kind === "image";
	if (slotId === "referenceVideos") return kind === "video";
	return false;
}

function defaultNodeName(project: ContentProjectDocument, kind: ContentNodeKind): string {
	const ordinal = project.graph.nodes.filter((node) => node.kind === kind).length + 1;
	return `${kind} ${ordinal}`;
}

export function applyContentProjectCommands(
	project: ContentProjectDocument,
	commands: readonly ContentProjectCommand[],
	now = new Date().toISOString(),
): ContentProjectDocument {
	if (commands.length === 0) return project;
	if (commands.length === 1) {
		const command = commands[0];
		if (command?.type === "node.update") {
			const node = findNode(project, command.nodeId);
			if (contentNodeDataEqual(node.data, { ...node.data, ...command.data })) return project;
		}
		if (command?.type === "job.update") {
			const job = findJob(project, command.jobId);
			const progress = normalizeJobProgress(command.progress, job.progress);
			if (job.status === command.status && job.progress === progress) return project;
		}
	}
	const next = structuredClone(project);
	for (const command of commands) applyCommand(next, command, now);
	assertWorkflow(next);
	next.revision = project.revision + 1;
	next.updatedAt = now;
	return next;
}
