import type {
	CanvasPosition,
	TimelineClip,
	ContentEdge,
	ContentNode,
	ContentNodeKind,
	ContentProjectDocument,
} from "./model";

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
	| { type: "node.delete"; nodeId: string }
	| { type: "edge.connect"; source: string; target: string }
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

function applyCommand(project: ContentProjectDocument, command: ContentProjectCommand): void {
	switch (command.type) {
		case "node.add": {
			assertPosition(command.node.position);
			const id = command.node.id ?? crypto.randomUUID();
			if (project.graph.nodes.some((node) => node.id === id)) {
				throw new ContentProjectCommandError(`node already exists: ${id}`);
			}
			project.graph.nodes.push({
				id,
				kind: command.node.kind,
				position: command.node.position,
				status: "idle",
				data: command.node.data ?? {},
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
			findNode(project, command.nodeId).position = command.position;
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
			return;
		}
		case "edge.connect": {
			if (command.source === command.target) throw new ContentProjectCommandError("a node cannot connect to itself");
			findNode(project, command.source);
			findNode(project, command.target);
			if (project.graph.edges.some((edge) => edge.source === command.source && edge.target === command.target)) return;
			const edge: ContentEdge = {
				id: crypto.randomUUID(),
				source: command.source,
				target: command.target,
			};
			project.graph.edges.push(edge);
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
	const next = structuredClone(project);
	for (const command of commands) applyCommand(next, command);
	next.revision = project.revision + 1;
	next.updatedAt = now;
	return next;
}

