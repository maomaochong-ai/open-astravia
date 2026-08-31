import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineRuntimeObservation, RuntimeObservationHub } from "@vetta/runtime-core/observation";
import type { RuntimeTracer } from "@vetta/runtime-telemetry";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDesktopAgentObservability } from "./composition.js";

const remoteFactory = vi.hoisted(() => vi.fn<() => RuntimeTracer | undefined>(() => undefined));
vi.mock("@vetta/runtime-telemetry/langfuse", () => ({ createLangfuseRuntimeTracerFromEnv: remoteFactory }));

describe("Desktop Agent observability ownership", () => {
	const directories: string[] = [];
	const owners: ReturnType<typeof createDesktopAgentObservability>[] = [];
	beforeEach(() => {
		remoteFactory.mockReset().mockReturnValue(undefined);
	});
	afterEach(async () => {
		for (const owner of owners.splice(0)) await owner.close();
		for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
	});
	async function createOwner() {
		const directory = await mkdtemp(join(tmpdir(), "desktop-observability-"));
		directories.push(directory);
		const logger = { warn: vi.fn() };
		const owner = createDesktopAgentObservability(directory, logger);
		owners.push(owner);
		return { owner, directory, logger };
	}
	it("collects Hub events and native spans without UI, flushes on close and isolates owners", async () => {
		const first = await createOwner();
		const second = await createOwner();
		const hub = new RuntimeObservationHub();
		hub.attach(first.owner.port, { id: "desktop.agent-observability" });
		try {
			hub.record({
				token: defineRuntimeObservation("test", "event"),
				timestamp: Date.now(),
				context: { sessionId: "session" },
				payload: { count: 1 },
			});
			const span = first.owner.tracer.startObservation("agent.run", { sessionId: "session" }, { type: "agent" });
			await hub.close();
			// Closing the Hub does not own or interrupt native execution.
			span.end();
			await first.owner.close();
			const page = await first.owner.query({ sessionId: "session" });
			expect(page.records.map((record) => record.kind).sort()).toEqual(["agent", "event"]);
			expect(page.records.every((record) => record.state === "completed")).toBe(true);
			expect(await readFile(join(first.directory, "agent-traces.json"), "utf8")).toContain("agent.run");
			expect((await second.owner.query({ sessionId: "session" })).records).toEqual([]);
			second.owner.tracer.startObservation("agent.second", { sessionId: "session" }).end();
			expect((await second.owner.query({ sessionId: "session" })).records).toHaveLength(1);
		} finally {
			await hub.close();
		}
	});
	it("keeps local observations and reports safe degradation when the remote exporter cannot initialize", async () => {
		remoteFactory.mockImplementation(() => {
			throw new Error("private credential failure");
		});
		const { owner, logger } = await createOwner();
		owner.tracer.startObservation("agent.run", { sessionId: "session" }).end();
		const page = await owner.query({ sessionId: "session" });
		expect(page.records).toHaveLength(1);
		expect(page.health.issue).toBe("TRACE_ADAPTER_FAILED");
		expect(logger.warn).toHaveBeenCalledWith("[agent-observability] local diagnostics degraded", {
			code: "TRACE_ADAPTER_FAILED",
		});
		expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("private");
	});
});
