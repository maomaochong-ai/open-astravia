import { serializeContentProject } from "../project/persistence";
import type { ContentProjectDocument } from "../project/types";

export function createContentCreationAgentState(project: ContentProjectDocument) {
	const { view: _view, createdAt: _createdAt, updatedAt: _updatedAt, ...document } =
		serializeContentProject(project);
	const assets = document.assets.map(({ source: _source, createdAt: _assetCreatedAt, ...asset }) => asset);
	const activeRuntime = project.graph.nodes.flatMap((node) =>
		node.status === "queued" || node.status === "running" || node.status === "failed"
			? [{ nodeId: node.id, status: node.status }]
			: [],
	);
	return activeRuntime.length > 0
		? { ...document, assets, runtime: { nodes: activeRuntime } }
		: { ...document, assets };
}
