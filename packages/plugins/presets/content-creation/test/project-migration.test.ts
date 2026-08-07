import { describe, expect, it } from "vitest";
import { migrateContentProjectDocument } from "../src/project/migrate-project";
import { createContentProject } from "../src/project/types";

describe("content project migrations", () => {
	it("replaces persisted media URLs with stable blob identifiers", () => {
		const legacy = {
			...createContentProject("C:/project"),
			schemaVersion: 1,
			assets: [
				{
					id: "asset",
					kind: "image",
					name: "Reference",
					mimeType: "image/png",
					url: "vetta-media://stale-path",
					createdAt: "2026-01-01T00:00:00.000Z",
				},
			],
		};

		const migrated = migrateContentProjectDocument(legacy, null, "C:/project");

		expect(migrated?.project.schemaVersion).toBe(4);
		expect(migrated?.project.assets).toEqual([
			{
				id: "asset",
				blobId: "asset",
				kind: "image",
				name: "Reference",
				mimeType: "image/png",
				createdAt: "2026-01-01T00:00:00.000Z",
			},
		]);
	});

	it("moves inline jobs and node statuses into runtime state while persisting node names", () => {
		const current = createContentProject("C:/project", "2026-01-01T00:00:00.000Z");
		const legacy = {
			...current,
			schemaVersion: 2,
			graph: {
				edges: [],
				nodes: [
					{
						id: "prompt",
						kind: "prompt",
						position: { x: 0, y: 0 },
						status: "failed",
						data: { label: "电影提示词", prompt: "夜晚的城市" },
					},
				],
			},
			jobs: [
				{
					id: "job",
					nodeId: "prompt",
					provider: "provider",
					model: "model",
					status: "failed",
					progress: 1,
					createdAt: current.createdAt,
					updatedAt: current.updatedAt,
				},
			],
		};

		const migrated = migrateContentProjectDocument(legacy, null, "C:/project");

		expect(migrated?.migrated).toBe(true);
		expect(migrated?.project.graph.nodes[0]).toMatchObject({ name: "电影提示词", status: "failed" });
		expect(migrated?.project.graph.nodes[0]?.purpose).toBeTruthy();
		expect(migrated?.project.graph.nodes[0]?.data).not.toHaveProperty("label");
		expect(migrated?.project.jobs).toHaveLength(1);
	});
});
