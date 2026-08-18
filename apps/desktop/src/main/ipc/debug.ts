import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { ipcMain } from "electron";
import type { ToolCallRecord } from "../../preload/api.js";
import { clearDebugDir, listRequestFiles } from "../debug-writer.js";

const CHANNELS = {
	PARSE_TOOL_CALLS: "vetta:debug:parse-tool-calls",
	LIST_REQUEST_FILES: "vetta:debug:list-request-files",
	CLEAR_DEBUG_DIR: "vetta:debug:clear-debug-dir",
} as const;

/** Size threshold (10MB) above which we use streaming instead of readFileSync */
const STREAM_THRESHOLD = 10 * 1024 * 1024;

interface JournalMessage {
	role: string;
	content?: Array<{ type: string; id?: string; name?: string; arguments?: unknown; text?: string }>;
	toolCallId?: string;
	toolName?: string;
	isError?: boolean;
}

interface JournalEntry {
	type: string;
	timestamp?: string;
	message?: JournalMessage;
}

function extractToolCalls(lines: string[]): ToolCallRecord[] {
	const pendingCalls = new Map<string, { toolName: string; args: unknown; timestamp: string; id: string }>();
	const results: ToolCallRecord[] = [];
	let idCounter = 0;

	for (const line of lines) {
		if (!line.trim()) continue;
		let entry: JournalEntry;
		try {
			entry = JSON.parse(line) as JournalEntry;
		} catch {
			continue;
		}

		if (entry.type !== "message" || !entry.message) continue;

		const msg = entry.message;

		if (msg.role === "assistant" && Array.isArray(msg.content)) {
			for (const block of msg.content) {
				if (block.type === "toolCall" && block.id && block.name) {
					pendingCalls.set(block.id, {
						toolName: block.name,
						args: block.arguments ?? {},
						timestamp: entry.timestamp ?? "",
						id: String(++idCounter),
					});
				}
			}
		}

		if (msg.role === "toolResult" && msg.toolCallId) {
			const pending = pendingCalls.get(msg.toolCallId);
			if (pending) {
				results.push({
					id: pending.id,
					toolName: pending.toolName,
					toolCallId: msg.toolCallId,
					timestamp: pending.timestamp,
					args: pending.args,
					result: msg.content,
					isError: msg.isError ?? false,
				});
				pendingCalls.delete(msg.toolCallId);
			}
		}
	}

	// Add any unmatched tool calls (still pending - no result yet)
	for (const [toolCallId, pending] of pendingCalls) {
		results.push({
			id: pending.id,
			toolName: pending.toolName,
			toolCallId,
			timestamp: pending.timestamp,
			args: pending.args,
			result: undefined,
			isError: false,
		});
	}

	return results;
}

async function parseToolCallsStreaming(sessionPath: string): Promise<ToolCallRecord[]> {
	const lines: string[] = [];
	const rl = createInterface({
		input: createReadStream(sessionPath, { encoding: "utf8" }),
		crlfDelay: Infinity,
	});
	for await (const line of rl) {
		// Only keep lines that are relevant to tool calls
		if (line.includes('"toolCall"') || line.includes('"toolResult"')) {
			lines.push(line);
		}
	}
	return extractToolCalls(lines);
}

function parseToolCallsSync(sessionPath: string): ToolCallRecord[] {
	const content = readFileSync(sessionPath, "utf8");
	const lines = content.split("\n");
	return extractToolCalls(lines);
}

export function registerDebugIpc(): () => void {
	ipcMain.handle(CHANNELS.PARSE_TOOL_CALLS, async (_event, sessionPath: unknown) => {
		if (typeof sessionPath !== "string" || !sessionPath) {
			throw new Error("Invalid sessionPath");
		}
		if (!existsSync(sessionPath)) return [];

		const stat = statSync(sessionPath);
		if (stat.size > STREAM_THRESHOLD) {
			return parseToolCallsStreaming(sessionPath);
		}
		return parseToolCallsSync(sessionPath);
	});

	ipcMain.handle(CHANNELS.LIST_REQUEST_FILES, async (_event, projectName: unknown, sessionId: unknown) => {
		if (typeof projectName !== "string" || !projectName) throw new Error("Invalid projectName");
		if (typeof sessionId !== "string" || !sessionId) throw new Error("Invalid sessionId");
		return listRequestFiles(projectName, sessionId);
	});

	ipcMain.handle(CHANNELS.CLEAR_DEBUG_DIR, async () => {
		await clearDebugDir();
	});

	return () => {
		ipcMain.removeHandler(CHANNELS.PARSE_TOOL_CALLS);
		ipcMain.removeHandler(CHANNELS.LIST_REQUEST_FILES);
		ipcMain.removeHandler(CHANNELS.CLEAR_DEBUG_DIR);
	};
}
