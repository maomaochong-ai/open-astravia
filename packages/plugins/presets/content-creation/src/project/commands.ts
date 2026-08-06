import type {
	CanvasPosition,
	ContentAsset,
	ContentEdge,
	GenerationJob,
	ContentNode,
	ContentNodeKind,
	ContentProjectDocument,
	TimelineClip,
} from "./types";
import { contentNodeDataEqual } from "../node/content-node-data-equal";
import { resolveContentConnection } from "../node/connections";
import { createDefaultContentNodeData } from "../node/definitions";
import { getContentNodeSize } from "../node/geometry";

export type ContentProjectCommand =
	| {
			type: "node.add";
			node: {
				id?: string;
				kind: ContentNodeKind;
				position: CanvasPosition;
				data?: ContentNode["data"];
			};
	  }
	| { type: "node.update"; nodeId: string; data: ContentNode["data"] }
	| { type: "node.move"; nodeId: string; position: CanvasPosition }
	| { type: "node.resize"; nodeId: string; width: number; height: number; position?: CanvasPosition }
	| { type: "node.lock"; nodeId: string; locked: boolean }
	| { type: "node.duplicate"; nodeId: string; position?: CanvasPosition }
	| { type: "node.delete"; nodeId: string }
	| { type: "edge.connect"; source: string; target: string; sourceHandle?: string; targetHandle?: string }
	| { type: "edge.delete"; edgeId: string }
	| { type: "asset.add"; asset: ContentAsset }
	| { type: "job.start"; job: { id: string; nodeId: string; providerId: string; modelId: string } }
	| { type: "job.succeed"; jobId: string; asset: ContentAsset }
	| { type: "job.fail"; jobId: string; error: string; errorCode?: GenerationJob["errorCode"] }
	| {
			type: "timeline.clip.add";
			clip: Omit<TimelineClip, "id"> & { id?: string };
	  }
	| { type: "timeline.clip.move"; clipId: string; trackId: string; start: number }
	| { type: "timeline.clip.trim"; clipId: string; sourceIn: number; duration: number }
	| { type: "timeline.clip.delete"; clipId: string };

export class ContentProjectCommandError extends Error {}

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

function applyCommand(project: ContentProjectDocument, command: ContentProjectCommand, now: string): void {
	switch (command.type) {
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
				position: command.node.position,
				...size,
				status: "idle",
				data,
			});
			return;
		}
		case "node.update": {
			const node = findNode(project, command.nodeId);
			node.data = { ...node.data, ...command.data };
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
			assertPosition(position);
			project.graph.nodes.push({
				...structuredClone(source),
				id: crypto.randomUUID(),
				position,
				locked: false,
				status: "idle",
			});
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
			return;
		}
		case "edge.connect": {
			if (command.source === command.target) throw new ContentProjectCommandError("a node cannot connect to itself");
			const sourceNode = findNode(project, command.source);
			const targetNode = findNode(project, command.target);
			const connection = resolveContentConnection(
				project,
				sourceNode,
				targetNode,
				command.sourceHandle,
				command.targetHandle,
			);
			if (!connection) throw new ContentProjectCommandError("node ports are incompatible or would create a cycle");
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
				id: crypto.randomUUID(),
				source: command.source,
				target: command.target,
				sourceHandle: connection.sourceHandle,
				targetHandle: connection.targetHandle,
			};
			project.graph.edges.push(edge);
			return;
		}
		case "edge.delete": {
			if (!project.graph.edges.some((edge) => edge.id === command.edgeId)) {
				throw new ContentProjectCommandError(`edge not found: ${command.edgeId}`);
			}
			project.graph.edges = project.graph.edges.filter((edge) => edge.id !== command.edgeId);
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
				status: "running",
				progress: 0,
				createdAt: now,
				updatedAt: now,
			});
			node.status = "running";
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
	}
	const next = structuredClone(project);
	for (const command of commands) applyCommand(next, command, now);
	next.revision = project.revision + 1;
	next.updatedAt = now;
	return next;
}
