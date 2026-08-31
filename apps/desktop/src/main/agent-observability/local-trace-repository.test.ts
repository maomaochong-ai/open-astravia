import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RuntimeTraceRecord } from "@vetta/runtime-telemetry";
import { atomicWriteJSONAsync } from "@vetta/toolkit/atomic-write";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalTraceRepository } from "./local-trace-repository.js";

describe("bounded local Trace persistence and query", () => {
	const directories: string[] = [];
	const repositories: LocalTraceRepository[] = [];
	afterEach(async () => {
		for (const repository of repositories) await repository.flush();
		for (const directory of directories) await rm(directory, { recursive: true, force: true });
	});
	async function fixture(options: Partial<ConstructorParameters<typeof LocalTraceRepository>[0]> = {}) {
		const directory = await mkdtemp(join(tmpdir(), "agent-traces-"));
		directories.push(directory);
		const path = join(directory, "traces.json");
		const repository = new LocalTraceRepository({ path, now: () => 100, ...options });
		repositories.push(repository);
		return { repository, path };
	}
	it("persists atomic updates, recovers interrupted spans and isolates session/filter/cursor queries", async () => {
		const { repository, path } = await fixture();
		repository.append(row("a", 10));
		repository.append(row("b", 20, "error"));
		repository.append({ ...row("other", 30), context: { sessionId: "other" } });
		repository.append(row("running", 40, "running"));
		const first = await repository.query({ sessionId: "session", limit: 1 });
		expect(first.records.map(({ id }) => id)).toEqual(["running"]);
		const next = await repository.query({ sessionId: "session", cursor: first.nextCursor, limit: 1 });
		expect(next.records.map(({ id }) => id)).toEqual(["b"]);
		expect((await repository.query({ sessionId: "session", errorsOnly: true })).records.map(({ id }) => id)).toEqual([
			"b",
		]);
		const restored = new LocalTraceRepository({ path, now: () => 100 });
		repositories.push(restored);
		expect((await restored.query({ sessionId: "session" })).records[0]?.state).toBe("interrupted");
		expect(JSON.parse(await readFile(path, "utf8")).schemaVersion).toBe(1);
	});
	it("retries a failed write without dropping in-memory records or swallowing later updates", async () => {
		let fail = true;
		const write = vi.fn(async (path: string, value: unknown) => {
			if (fail) throw new Error("secret disk path");
			await atomicWriteJSONAsync(path, value);
		});
		const { repository, path } = await fixture({ write });
		repository.append(row("a", 1));
		expect((await repository.query({ sessionId: "session" })).health.issue).toBe("TRACE_STORAGE_FAILED");
		fail = false;
		repository.append(row("b", 2));
		const recovered = await repository.query({ sessionId: "session" });
		expect(recovered.health.issue).toBeNull();
		expect(recovered.records).toHaveLength(2);
		expect(await readFile(path, "utf8")).not.toContain("secret");
	});
	it("bounds retention and capacity and does not expose arbitrary disk fields", async () => {
		const { repository, path } = await fixture({ maxRecords: 2, retentionMs: 50 });
		for (const [id, time] of [
			["old", 1],
			["a", 70],
			["b", 80],
			["c", 90],
		] as const)
			repository.append(row(id, time));
		const result = await repository.query({ sessionId: "session" });
		expect(result.records.map(({ id }) => id)).toEqual(["c", "b"]);
		expect(result.health.dropped).toBe(1);
		expect(JSON.parse(await readFile(path, "utf8")).records).toHaveLength(2);
	});
	it.each(["{", '{"schemaVersion":2,"records":[]}', '{"schemaVersion":1,"records":[{}]}'])(
		"preserves unreadable/future data while retaining new records in memory",
		async (content) => {
			const { repository, path } = await fixture();
			await writeFile(path, content);
			repository.append(row("a", 10));
			const result = await repository.query({ sessionId: "session" });
			expect(result.records).toHaveLength(1);
			expect(result.health.issue).toBe("TRACE_FORMAT_INVALID");
			expect(await readFile(path, "utf8")).toBe(content);
		},
	);
	it("serializes a concurrent append behind an in-flight checkpoint without losing the update", async () => {
		let unblock!: () => void;
		let started!: () => void;
		const gate = new Promise<void>((resolve) => {
			unblock = resolve;
		});
		const entered = new Promise<void>((resolve) => {
			started = resolve;
		});
		let writes = 0;
		const { repository, path } = await fixture({
			write: async (path, value) => {
				if (writes++ === 0) {
					started();
					await gate;
				}
				await atomicWriteJSONAsync(path, value);
			},
		});
		repository.append(row("a", 10, "running"));
		const first = repository.flush();
		await entered;
		repository.append({ ...row("a", 10), endedAt: 20 });
		repository.append(row("b", 30));
		const second = repository.flush();
		unblock();
		await Promise.all([first, second]);
		const stored = JSON.parse(await readFile(path, "utf8"));
		expect(stored.records).toHaveLength(2);
		expect(stored.records.find((record: RuntimeTraceRecord) => record.id === "a").state).toBe("completed");
	});
	it("limits serialized bytes as well as record count", async () => {
		const { repository, path } = await fixture({ maxBytes: 600 });
		for (let i = 0; i < 10; i++) repository.append(row(`id-${i}`, i + 1));
		await repository.flush();
		expect(Buffer.byteLength(await readFile(path, "utf8"), "utf8")).toBeLessThanOrEqual(600);
		expect((await repository.query({ sessionId: "session" })).health.dropped).toBeGreaterThan(0);
	});
	it("rejects invalid transport queries instead of broadening their scope", async () => {
		const { repository } = await fixture();
		for (const input of [
			{},
			{ sessionId: "session", limit: 10000 },
			{ sessionId: "session", cursor: "../../secret" },
			{ sessionId: "session", errorsOnly: "yes" },
		])
			await expect(repository.query(input)).rejects.toThrow("TRACE_QUERY_INVALID");
	});
});
function row(id: string, startedAt: number, state: RuntimeTraceRecord["state"] = "completed"): RuntimeTraceRecord {
	return {
		schemaVersion: 1,
		id,
		traceId: "trace",
		name: "test.span",
		kind: "span",
		startedAt,
		state,
		context: { sessionId: "session", turnId: "turn" },
		metadata: {},
		usage: {},
		cost: {},
	};
}
