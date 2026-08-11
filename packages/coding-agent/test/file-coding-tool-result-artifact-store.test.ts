import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileCodingToolResultArtifactStore } from "../src/tool-results/file-result-artifact-store.js";

describe("FileCodingToolResultArtifactStore", () => {
	it("writes exact content and deletes only the requested session directory", async () => {
		const root = await mkdtemp(join(tmpdir(), "vetta-tool-results-"));
		try {
			const store = new FileCodingToolResultArtifactStore(root);
			const first = await write(store, "../session:one", "read");
			const second = await write(store, "session-two", "grep");

			expect(await readFile(first.reference, "utf8")).toBe('{"content":"complete"}');
			await store.deleteSessionArtifacts("../session:one");
			expect(existsSync(first.reference)).toBe(false);
			expect(existsSync(second.reference)).toBe(true);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

function write(store: FileCodingToolResultArtifactStore, sessionId: string, toolName: string) {
	return store.write({
		sessionId,
		turnId: "turn",
		toolCallId: "call",
		toolName,
		mediaType: "application/json",
		data: '{"content":"complete"}',
		byteLength: 22,
	});
}
