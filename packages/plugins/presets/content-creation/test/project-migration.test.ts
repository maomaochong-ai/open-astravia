import { describe, expect, it } from "vitest";
import { migrateContentProjectDocument } from "../src/project/migrate-project";
import { serializeContentProject } from "../src/project/persistence";
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

		expect(migrated?.project.schemaVersion).toBe(6);
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

	it("round-trips frame and omni-reference roles without losing inactive mode inputs", () => {
		const project = createContentProject("C:/project", "2026-08-10T00:00:00.000Z");
		project.assets.push(
			{ id: "first", blobId: "first", kind: "image", name: "first.png", mimeType: "image/png", createdAt: project.createdAt },
			{ id: "last", blobId: "last", kind: "image", name: "last.png", mimeType: "image/png", createdAt: project.createdAt },
			{ id: "video", blobId: "video", kind: "video", name: "video.mp4", mimeType: "video/mp4", createdAt: project.createdAt },
		);
		project.graph.nodes.push({
			id: "generator",
			kind: "video-generator",
			position: { x: 0, y: 0 },
			status: "idle",
			data: {
				modeId: "image-to-video",
				inputs: [
					{ id: "first-binding", assetId: "first", slotId: "firstFrame" },
					{ id: "last-binding", assetId: "last", slotId: "lastFrame" },
					{ id: "video-binding", assetId: "video", slotId: "referenceVideos" },
				],
			},
		});

		const restored = migrateContentProjectDocument(serializeContentProject(project), null, "C:/project")?.project;

		expect(restored?.graph.nodes[0]?.data.inputs).toEqual([
			expect.objectContaining({ assetId: "first", slotId: "firstFrame" }),
			expect.objectContaining({ assetId: "last", slotId: "lastFrame" }),
			expect.objectContaining({ assetId: "video", slotId: "referenceVideos" }),
		]);
	});

	it("migrates v4 video input groups into role-preserving v5 media sources", () => {
		const current = serializeContentProject(createContentProject("C:/project", "2026-08-10T00:00:00.000Z"));
		const legacy = {
			...current,
			schemaVersion: 4,
			nodes: [{
				id: "first",
				name: "first",
				purpose: "first",
				type: "image-generator",
				content: { versions: { original: { segments: [{ type: "text", value: "frame" }] } }, activeVersion: "original" },
				inputs: { promptSources: [], referenceImages: [] },
				generation: { model: { selection: "automatic" } },
				produces: { type: "image" },
				result: { state: "not-generated" },
			}, {
				id: "video",
				name: "video",
				purpose: "video",
				type: "video-generator",
				content: { versions: { original: { segments: [{ type: "text", value: "move" }] } }, activeVersion: "original" },
				inputs: {
					promptSources: [],
					startImages: [{ fromNode: "first", output: "image", assetIds: [], role: "firstFrame" }],
					referenceVideos: [],
				},
				generation: { model: { selection: "automatic" } },
				produces: { type: "video" },
				result: { state: "not-generated" },
			}],
			view: { nodes: { first: { x: 0, y: 0 }, video: { x: 400, y: 0 } } },
		};

		const migrated = migrateContentProjectDocument(legacy, null, "C:/project");
		expect(migrated?.project.schemaVersion).toBe(6);
		expect(serializeContentProject(migrated!.project).nodes[1]).toMatchObject({
			inputs: { mediaSources: [{ fromNode: "first", output: "image", role: "firstFrame" }] },
		});
	});

	it("marks every established v5 canvas position as user-owned", () => {
		const project = createContentProject("C:/project", "2026-08-10T00:00:00.000Z");
		project.graph.nodes.push({
			id: "prompt",
			kind: "prompt",
			position: { x: 40, y: 80 },
			status: "idle",
			data: {},
		});
		const current = serializeContentProject(project);
		const legacy = {
			...current,
			schemaVersion: 5,
			view: {
				nodes: Object.fromEntries(
					Object.entries(current.view.nodes).map(([nodeId, view]) => {
						const { layoutOwnership: _layoutOwnership, ...legacyView } = view;
						return [nodeId, legacyView];
					}),
				),
			},
		};

		const migrated = migrateContentProjectDocument(legacy, null, "C:/project");

		expect(migrated?.project.schemaVersion).toBe(6);
		expect(migrated?.project.graph.nodes.every((node) => node.layoutOwnership === "user")).toBe(true);
	});
});
