import type { CodingAgentModelRuntime } from "@vetta/coding-agent/host-services";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDesktopKnowledgeProcessingSessionFactory } from "./processing-session-factory.js";

const factoryMocks = vi.hoisted(() => ({
	greenfield: vi.fn(() => ({ create: vi.fn() })),
}));

vi.mock("@vetta/coding-agent/composition", () => ({
	createKnowledgeProcessingSessionFactory: factoryMocks.greenfield,
}));

describe("createDesktopKnowledgeProcessingSessionFactory", () => {
	const modelRegistry = {} as CodingAgentModelRuntime;
	const getModelRegistry = () => modelRegistry;

	beforeEach(() => {
		factoryMocks.greenfield.mockClear();
	});

	it("creates the production knowledge processing session factory", () => {
		const factory = createDesktopKnowledgeProcessingSessionFactory({
			getModelRegistry,
		});

		expect(factory).toBe(factoryMocks.greenfield.mock.results[0]?.value);
		expect(factoryMocks.greenfield).toHaveBeenCalledWith({ getModelRegistry });
	});
});
