import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startDesktopLocalRpcServer } from "./server.js";

vi.mock("../logger.js", () => ({
	getAppLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

const runtime = {
	actions: {
		search: () => [],
		describe: () => ({}),
		run: () => ({}),
	},
};

const openServers: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
	await Promise.all(openServers.splice(0).map((server) => server.close()));
});

describe("Desktop local RPC endpoint lifecycle", () => {
	it("publishes complete endpoint documents and does not remove a newer server endpoint", async () => {
		const root = await mkdtemp(join(tmpdir(), "vetta-local-rpc-"));
		const endpointFilePath = join(root, "action-server.json");
		try {
			const first = await startDesktopLocalRpcServer(runtime, { endpointFilePath });
			openServers.push(first);
			expect(JSON.parse(await readFile(endpointFilePath, "utf8"))).toEqual(first.endpoint);

			const second = await startDesktopLocalRpcServer(runtime, { endpointFilePath });
			openServers.push(second);
			expect(JSON.parse(await readFile(endpointFilePath, "utf8"))).toEqual(second.endpoint);

			await first.close();
			expect(JSON.parse(await readFile(endpointFilePath, "utf8"))).toEqual(second.endpoint);

			await second.close();
			openServers.splice(openServers.indexOf(second), 1);
			await expect(readFile(endpointFilePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
