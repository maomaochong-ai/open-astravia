import { describe, expect, it, vi } from "vitest";
import { runCodingAgentCliControl } from "../src/coding-agent-cli-control.js";

describe("Coding Agent CLI control bootstrap boundary", () => {
	it("requires the host to provide bootstrap capabilities for model commands", async () => {
		await expect(runCodingAgentCliControl(["--list-models"])).rejects.toThrow(
			"CLI control requires a host-provided Coding Agent bootstrap factory",
		);
	});

	it("does not initialize bootstrap for commands that do not need it", async () => {
		const createBootstrap = vi.fn();

		await expect(runCodingAgentCliControl([], { createBootstrap })).resolves.toBe(false);

		expect(createBootstrap).not.toHaveBeenCalled();
	});
});
