import type { ContentModelDescriptor } from "../generation/types";

interface ContentFlowProjectVersion {
	projectId: string;
	revision: number;
	updatedAt: string;
	nodeCount: number;
	edgeCount: number;
}

export function createContentProjectSyncKey(
	project: ContentFlowProjectVersion,
	models: readonly ContentModelDescriptor[],
): string {
	const modelKey = models
		.map((model) =>
			[
				model.providerId,
				model.modelId,
				model.capabilities.join(","),
				model.aspectRatios.join(","),
			].join("\u0002"),
		)
		.join("\u0001");
	return [
		project.projectId,
		project.revision,
		project.updatedAt,
		project.nodeCount,
		project.edgeCount,
		modelKey,
	].join("\u0000");
}
