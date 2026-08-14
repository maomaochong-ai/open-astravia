import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { nodeRuntimeHostPathServices, nodeRuntimeQueueSidecarStore } from "./runtime-host-services.js";

describe("Node RuntimeHost services", () => {
	const temporaryRoots: string[] = [];

	afterEach(async () => {
		for (const root of temporaryRoots.splice(0)) await rm(root, { recursive: true, force: true });
	});

	it("normalizes paths and creates nested working directories", async () => {
		const root = await createTemporaryRoot();
		const nested = join(root, "workspace", "nested");

		await nodeRuntimeHostPathServices.ensureDirectory(nested);

		expect(nodeRuntimeHostPathServices.normalize(nested)).toBe(resolve(nested));
		expect((await stat(nested)).isDirectory()).toBe(true);
	});

	it("round-trips and removes queue sidecar snapshots", async () => {
		const root = await createTemporaryRoot();
		const sessionPath = join(root, "session.jsonl");
		const snapshot = { paused: true, entries: [{ id: "queued-1" }] };

		await nodeRuntimeQueueSidecarStore.write(sessionPath, snapshot);

		await expect(nodeRuntimeQueueSidecarStore.read(sessionPath)).resolves.toEqual(snapshot);
		expect(JSON.parse(await readFile(`${sessionPath}.queue.json`, "utf8"))).toEqual(snapshot);

		await nodeRuntimeQueueSidecarStore.remove(sessionPath);
		await expect(nodeRuntimeQueueSidecarStore.read(sessionPath)).rejects.toMatchObject({ code: "ENOENT" });
	});

	async function createTemporaryRoot(): Promise<string> {
		const root = await mkdtemp(join(tmpdir(), "vetta-runtime-host-services-"));
		temporaryRoots.push(root);
		return root;
	}
});
