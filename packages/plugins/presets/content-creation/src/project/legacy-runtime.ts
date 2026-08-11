import type { ConfigRecord } from "@vetta/toolkit/versioned-config";
import { isContentProjectRuntime, isGenerationJob } from "./persistence";
import {
	CONTENT_CREATION_RUNTIME_SCHEMA_VERSION,
	type ContentNodeStatus,
	type ContentProjectRuntimeDocument,
	type GenerationJob,
} from "./types";

interface InlineRuntimeState {
	hasInlineState: boolean;
	jobs: GenerationJob[];
	nodeStatuses: Record<string, ContentNodeStatus>;
}

export function resolveContentProjectRuntime(
	runtimeValue: unknown,
	legacyDocument: ConfigRecord,
	projectId: string,
	updatedAt: string,
): { runtime: ContentProjectRuntimeDocument; migrated: boolean } {
	const inline = readInlineRuntime(legacyDocument);
	if (isContentProjectRuntime(runtimeValue) && runtimeValue.projectId === projectId) {
		return { runtime: runtimeValue, migrated: inline.hasInlineState };
	}
	return {
		migrated: inline.hasInlineState,
		runtime: {
			schemaVersion: CONTENT_CREATION_RUNTIME_SCHEMA_VERSION,
			projectId,
			updatedAt,
			jobs: inline.jobs,
			nodeStatuses: inline.nodeStatuses,
		},
	};
}

export function contentNodeStatusFromRuntime(
	runtime: ContentProjectRuntimeDocument,
	nodeId: string,
): ContentNodeStatus {
	const persisted = runtime.nodeStatuses[nodeId];
	if (persisted) return persisted;
	const latest = runtime.jobs.filter((job) => job.nodeId === nodeId).at(-1)?.status;
	return latest === "queued" || latest === "running" || latest === "succeeded" || latest === "failed"
		? latest
		: "idle";
}

function readInlineRuntime(value: ConfigRecord): InlineRuntimeState {
	const jobs = Array.isArray(value.jobs) ? value.jobs.filter(isGenerationJob) : [];
	const graph = asRecord(value.graph);
	const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
	const nodeStatuses: Record<string, ContentNodeStatus> = {};
	for (const node of nodes) {
		if (!isRecord(node) || typeof node.id !== "string" || !isContentNodeStatus(node.status)) continue;
		nodeStatuses[node.id] = node.status;
	}
	return {
		hasInlineState: "jobs" in value || "cwd" in value || Object.keys(nodeStatuses).length > 0,
		jobs,
		nodeStatuses,
	};
}

function isContentNodeStatus(value: unknown): value is ContentNodeStatus {
	return value === "idle" || value === "queued" || value === "running" || value === "succeeded" || value === "failed";
}

function isRecord(value: unknown): value is ConfigRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): ConfigRecord {
	return isRecord(value) ? value : {};
}
