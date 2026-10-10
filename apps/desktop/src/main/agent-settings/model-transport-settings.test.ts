import { beforeEach, describe, expect, it, vi } from "vitest";

let document: Record<string, unknown>;
vi.mock("./settings-document-store.js", () => ({
	readAgentSettingsDocument: () => document,
	updateAgentSettingsDocument: (mutate: (settings: Record<string, unknown>) => void) => mutate(document),
}));

const { getModelTransport, normalizeModelTransport, setModelTransport } = await import("./model-transport-settings.js");

describe("model transport settings", () => {
	beforeEach(() => {
		document = {};
	});

	it("defaults invalid persisted values to SSE", () => {
		document.transport = "invalid";
		expect(getModelTransport()).toBe("sse");
	});

	it("validates and persists supported transports", () => {
		expect(setModelTransport("websocket")).toBe("websocket");
		expect(document.transport).toBe("websocket");
		expect(getModelTransport()).toBe("websocket");
	});

	it("rejects unsupported writes", () => {
		expect(() => normalizeModelTransport("socket", true)).toThrow("Invalid model transport: socket");
		expect(() => setModelTransport("socket")).toThrow("Invalid model transport: socket");
		expect(document).toEqual({});
	});
});
