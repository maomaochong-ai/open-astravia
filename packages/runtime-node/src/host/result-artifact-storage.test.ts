import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createNodeResultArtifactStorage } from "./result-artifact-storage.js";

describe("Node result artifact storage", () => {
	it("writes coding and MCP results with stable session-scoped names", async () => {
		const root = await mkdtemp(join(tmpdir(), "vetta-result-artifacts-"));
		try {
			const storage = createNodeResultArtifactStorage({
				codingRoot: join(root, "tool-results"),
				mcpRoot: join(root, "mcp-results"),
			});
			const coding = await storage.coding.write({
				sessionId: "../session:one",
				turnId: "turn",
				toolCallId: "call",
				toolName: "read/value",
				mediaType: "application/json",
				data: '{"content":"complete"}',
				byteLength: 22,
			});
			const mcp = await storage.mcp.write({
				sessionId: "../session:one",
				turnId: "turn",
				toolCallId: "call",
				serverName: "server/name",
				toolName: "lookup:value",
				mediaType: "application/json",
				data: '{"content":[{"type":"text","text":"complete"}]}',
				byteLength: 48,
			});

			expect(coding.reference).toMatch(/read-value-[a-f0-9]{12}-.*\.json$/);
			expect(mcp.reference).toMatch(/server-name-[a-f0-9]{12}-lookup-value-[a-f0-9]{12}-.*\.json$/);
			expect(await readFile(coding.reference, "utf8")).toBe('{"content":"complete"}');
			expect(await readFile(mcp.reference, "utf8")).toBe('{"content":[{"type":"text","text":"complete"}]}');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("deletes both result kinds for only the requested session", async () => {
		const root = await mkdtemp(join(tmpdir(), "vetta-result-cleaner-"));
		try {
			const storage = createNodeResultArtifactStorage({
				codingRoot: join(root, "tool-results"),
				mcpRoot: join(root, "mcp-results"),
			});
			const firstCoding = await writeCoding(storage, "../session:one");
			const firstMcp = await writeMcp(storage, "../session:one");
			const secondCoding = await writeCoding(storage, "session-two");

			await storage.cleaner.deleteSessionArtifacts("../session:one");

			expect(existsSync(firstCoding)).toBe(false);
			expect(existsSync(firstMcp)).toBe(false);
			expect(existsSync(secondCoding)).toBe(true);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

async function writeCoding(
	storage: ReturnType<typeof createNodeResultArtifactStorage>,
	sessionId: string,
): Promise<string> {
	return (
		await storage.coding.write({
			sessionId,
			turnId: "turn",
			toolCallId: "call",
			toolName: "read",
			mediaType: "application/json",
			data: "{}",
			byteLength: 2,
		})
	).reference;
}

async function writeMcp(
	storage: ReturnType<typeof createNodeResultArtifactStorage>,
	sessionId: string,
): Promise<string> {
	return (
		await storage.mcp.write({
			sessionId,
			turnId: "turn",
			toolCallId: "call",
			serverName: "server",
			toolName: "lookup",
			mediaType: "application/json",
			data: "{}",
			byteLength: 2,
		})
	).reference;
}
