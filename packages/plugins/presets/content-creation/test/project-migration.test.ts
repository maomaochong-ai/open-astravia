import { describe, expect, it } from "vitest";
import { migrateContentProjectDocument } from "../src/project/migrations";
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

		const migrated = migrateContentProjectDocument(legacy, "C:/project");

		expect(migrated?.schemaVersion).toBe(2);
		expect(migrated?.assets).toEqual([
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
});
