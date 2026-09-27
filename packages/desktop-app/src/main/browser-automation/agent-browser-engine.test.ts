import { describe, expect, it, vi } from "vitest";
import { AgentBrowserEngine } from "./agent-browser-engine.js";
import type { BrowserProcessRunner } from "./browser-process-runner.js";

function makeRunner(stdout: string, exitCode = 0): BrowserProcessRunner {
	return {
		run: vi.fn().mockResolvedValue({
			exitCode,
			stdout,
			stderr: "",
			durationMs: 0,
			truncated: false,
		}),
	};
}

const session = {
	id: "astravia-abc",
	source: "managed" as const,
	profile: { type: "ephemeral" as const },
	headed: true,
	configPath: "/tmp/browser-config.json",
};

describe("AgentBrowserEngine", () => {
	it("navigate passes correct args", async () => {
		const runner = makeRunner("navigated");
		const engine = new AgentBrowserEngine(runner);
		await engine.navigate(session, "https://github.com");
		expect(runner.run).toHaveBeenCalledWith(
			"agent-browser",
			[
				"--config",
				"/tmp/browser-config.json",
				"--session",
				"astravia-abc",
				"--pin-tab",
				"navigate",
				"https://github.com",
			],
			expect.objectContaining({ timeoutMs: 120_000 }),
		);
	});

	it("snapshot --interactive when requested", async () => {
		const runner = makeRunner("snapshot content");
		const engine = new AgentBrowserEngine(runner);
		await engine.snapshot(session, true);
		const args = (runner.run as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];
		expect(args).toContain("--interactive");
	});

	it("screenshot --full when requested", async () => {
		const runner = makeRunner("data:image/png;base64,abc");
		const engine = new AgentBrowserEngine(runner);
		const result = await engine.screenshot(session, true);
		const args = (runner.run as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];
		expect(args).toContain("--full");
		expect(result.dataUrl).toBe("data:image/png;base64,abc");
	});

	it("act builds click subcommand", async () => {
		const runner = makeRunner("clicked");
		const engine = new AgentBrowserEngine(runner);
		await engine.act(session, { type: "click", target: "@e1" });
		const args = (runner.run as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];
		expect(args).toContain("click");
		expect(args).toContain("@e1");
	});

	it("act builds fill subcommand", async () => {
		const runner = makeRunner("filled");
		const engine = new AgentBrowserEngine(runner);
		await engine.act(session, { type: "fill", target: "@e1", value: "hello" });
		const args = (runner.run as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];
		expect(args).toEqual(expect.arrayContaining(["fill", "@e1", "hello"]));
	});

	it("throws on non-zero exit code", async () => {
		const runner = makeRunner("", 1);
		const engine = new AgentBrowserEngine(runner);
		await expect(engine.navigate(session, "https://x")).rejects.toThrow(/exit 1/);
	});
});
