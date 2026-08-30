import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { createDesktopMcpInteractionHandlers } from "./mcp-supervisor.js";

describe("createDesktopMcpInteractionHandlers", () => {
	it("exposes only the permission-filtered project root", async () => {
		const projectRoot = process.platform === "win32" ? "C:\\workspace\\demo" : "/workspace/demo";
		const handlers = createDesktopMcpInteractionHandlers({ projectRoot });

		await expect(handlers.roots?.({}, { serverName: "demo", method: "roots/list", round: 1 })).resolves.toEqual({
			roots: [{ uri: pathToFileURL(projectRoot).href, name: "demo" }],
		});
	});

	it("does not advertise sampling until an approved host policy is injected", () => {
		const withoutPolicy = createDesktopMcpInteractionHandlers({ projectRoot: process.cwd() });
		expect(withoutPolicy.sampling).toBeUndefined();

		const sampling = vi.fn();
		const withPolicy = createDesktopMcpInteractionHandlers({ projectRoot: process.cwd(), samplingHandler: sampling });
		expect(withPolicy.sampling).toBe(sampling);
	});
});
