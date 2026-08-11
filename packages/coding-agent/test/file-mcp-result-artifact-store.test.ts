import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileMcpToolResultArtifactStore } from "../src/mcp/runtime/file-result-artifact-store.js";

describe("FileMcpToolResultArtifactStore", () => {
	it("writes an exact result atomically under a session-scoped directory", async () => {
		const root = await mkdtemp(join(tmpdir(), "vetta-mcp-results-"));
		try {
			const store = new FileMcpToolResultArtifactStore(root);
			const artifact = await store.write({
				sessionId: "../session:one",
				turnId: "turn",
				toolCallId: "call",
				serverName: "server/name",
				toolName: "lookup:value",
				mediaType: "application/json",
				data: '{"content":[{"type":"text","text":"complete"}]}',
				byteLength: 48,
			});

			expect(artifact.reference.startsWith(root)).toBe(true);
			expect(artifact.reference).toMatch(/server-name-[a-f0-9]{12}-lookup-value-[a-f0-9]{12}-.*\.json$/);
			expect(await readFile(artifact.reference, "utf8")).toBe('{"content":[{"type":"text","text":"complete"}]}');
			await store.deleteSessionArtifacts("../session:one");
			expect(existsSync(artifact.reference)).toBe(false);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
