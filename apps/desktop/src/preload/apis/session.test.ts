import type { IpcRenderer } from "electron";
import { describe, expect, it, vi } from "vitest";
import { createSessionApi } from "./session.js";

describe("createSessionApi trace propagation", () => {
	it("forwards the same correlation envelope for create and prompt", async () => {
		const invoke = vi.fn(async () => undefined);
		const ipc = { invoke } as unknown as IpcRenderer;
		const session = createSessionApi(ipc).session;
		const traceContext = { interactionId: "00000000-0000-4000-8000-000000000001" };

		await session.create({ cwd: "C:/workspace" }, "conversation", traceContext);
		await session.prompt("session-1", { text: "hello" }, traceContext);

		expect(invoke).toHaveBeenNthCalledWith(
			1,
			"vetta:session:create",
			{ cwd: "C:/workspace" },
			"conversation",
			traceContext,
		);
		expect(invoke).toHaveBeenNthCalledWith(2, "vetta:session:prompt", "session-1", { text: "hello" }, traceContext);
	});
});
