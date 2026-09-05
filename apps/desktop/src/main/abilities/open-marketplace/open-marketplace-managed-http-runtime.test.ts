import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	MANAGED_HTTP_RUNTIME_FILE,
	ManagedHttpRuntimeService,
	parseManagedHttpRuntimeSpec,
} from "./open-marketplace-managed-http-runtime";

const roots: string[] = [];
const PORT_TOKEN = `\${VETTA_MCP_PORT}`;

async function fixture(): Promise<{ root: string; id: string; command: string }> {
	const root = await mkdtemp(join(tmpdir(), "managed-http-runtime-"));
	roots.push(root);
	const id = "demo-0123456789ab";
	const command = join(root, id, "runtime", "versions", "1", "demo.exe");
	await mkdir(join(root, id, "runtime", "versions", "1"), { recursive: true });
	await writeFile(command, "runtime", "utf8");
	await writeFile(
		join(root, id, MANAGED_HTTP_RUNTIME_FILE),
		JSON.stringify({
			schemaVersion: 1,
			id,
			command,
			args: [`-port=:${PORT_TOKEN}`],
			env: { PORT: PORT_TOKEN },
			mcpPath: "/mcp",
			readyTimeoutMs: 1000,
		}),
		"utf8",
	);
	return { root, id, command };
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("ManagedHttpRuntimeService", () => {
	it("starts the binary once and returns its direct Streamable HTTP URL", async () => {
		const { root, id, command } = await fixture();
		const child = Object.assign(new EventEmitter(), {
			pid: 123,
			exitCode: null,
			killed: false,
			stdout: new EventEmitter(),
			stderr: new EventEmitter(),
			kill: vi.fn(() => true),
		});
		const spawnProcess = vi.fn(() => child);
		const fetchImpl = vi.fn(async () => new Response(null, { status: 405 }));
		const service = new ManagedHttpRuntimeService({
			rootDir: root,
			allocatePort: async () => 23456,
			spawnProcess: spawnProcess as never,
			fetchImpl,
		});

		await expect(Promise.all([service.ensure(id), service.ensure(id)])).resolves.toEqual([
			"http://127.0.0.1:23456/mcp",
			"http://127.0.0.1:23456/mcp",
		]);
		expect(spawnProcess).toHaveBeenCalledOnce();
		expect(spawnProcess).toHaveBeenCalledWith(
			command,
			["-port=:23456"],
			expect.objectContaining({ env: expect.objectContaining({ PORT: "23456" }) }),
		);
		expect(fetchImpl).toHaveBeenCalledWith("http://127.0.0.1:23456/mcp", expect.objectContaining({ method: "HEAD" }));
	});

	it("rejects a persisted command outside the ability runtime directory", async () => {
		const root = await mkdtemp(join(tmpdir(), "managed-http-runtime-invalid-"));
		roots.push(root);
		expect(() =>
			parseManagedHttpRuntimeSpec(
				{
					schemaVersion: 1,
					id: "demo",
					command: join(root, "escape.exe"),
					args: [],
					env: {},
					mcpPath: "/mcp",
					readyTimeoutMs: 1000,
				},
				root,
				"demo",
			),
		).toThrow(/runtime directory/);
	});
});
