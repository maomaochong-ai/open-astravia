import { describe, expect, it } from "vitest";
import { createContentProjectSyncKey } from "../src/canvas/flow-sync-key";
import type { ContentModelDescriptor } from "../src/generation/types";

const project = {
	projectId: "project",
	revision: 3,
	updatedAt: "2026-08-02T00:00:00.000Z",
	nodeCount: 2,
	edgeCount: 1,
};
const models: readonly ContentModelDescriptor[] = [
	{
		providerId: "openai",
		modelId: "gpt-image-2",
		capabilities: ["text-to-image"],
		aspectRatios: ["1:1"],
	},
];

describe("content project synchronization key", () => {
	it("stays stable for equivalent model arrays", () => {
		const first = createContentProjectSyncKey(project, models);
		const second = createContentProjectSyncKey(
			project,
			models.map((model) => ({ ...model })),
		);

		expect(second).toBe(first);
	});

	it("changes when persisted graph state changes", () => {
		const current = createContentProjectSyncKey(project, models);
		const next = createContentProjectSyncKey({ ...project, revision: 4, nodeCount: 3 }, models);

		expect(next).not.toBe(current);
	});
});
