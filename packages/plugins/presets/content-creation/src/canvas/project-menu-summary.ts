import type { ContentModelDescriptor } from "../generation/types";
import type { ContentProjectDocument, GenerationJobStatus } from "../project/types";

const ACTIVE_JOB_STATUSES = new Set<GenerationJobStatus>(["queued", "running"]);

export interface ContentProjectMenuSummary {
	workspaceName: string | null;
	nodeCount: number;
	assetCount: number;
	modelCount: number;
	activeJobNodeIds: readonly string[];
	failedJobNodeIds: readonly string[];
}

/** Derive menu-only presentation data without introducing another project state source. */
export function createContentProjectMenuSummary(
	project: ContentProjectDocument,
	models: readonly ContentModelDescriptor[],
): ContentProjectMenuSummary {
	const modelKeys = new Set(models.map((model) => `${model.providerId}\u0000${model.modelId}`));
	return {
		workspaceName: getWorkspaceName(project.cwd),
		nodeCount: project.graph.nodes.length,
		assetCount: project.assets.length,
		modelCount: modelKeys.size,
		activeJobNodeIds: uniqueJobNodeIds(project, (status) => ACTIVE_JOB_STATUSES.has(status)),
		failedJobNodeIds: uniqueJobNodeIds(project, (status) => status === "failed"),
	};
}

function uniqueJobNodeIds(
	project: ContentProjectDocument,
	matches: (status: GenerationJobStatus) => boolean,
): string[] {
	const existingNodeIds = new Set(project.graph.nodes.map((node) => node.id));
	return [
		...new Set(
			project.jobs
				.filter((job) => matches(job.status) && existingNodeIds.has(job.nodeId))
				.map((job) => job.nodeId),
		),
	];
}

function getWorkspaceName(cwd: string | null): string | null {
	if (!cwd) return null;
	const normalized = cwd.replace(/[\\/]+$/, "");
	return normalized.split(/[\\/]/).at(-1) || null;
}
