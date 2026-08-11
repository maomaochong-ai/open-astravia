import { randomUUID } from "node:crypto";
import type { AgentMessage, ToolPhase } from "@vetta/agent-core";
import type { ImageContent, TextContent } from "@vetta/ai";
import type { ExtensionSessionWriter } from "../../extensions/index.js";
import {
	CODING_AGENT_SESSION_VIEW_VERSION,
	type CodingAgentSessionEntry,
	type CodingAgentSessionHeader,
	type CodingAgentSessionTreeNode,
	projectCodingAgentSessionTree,
	readCodingAgentSessionBranch,
} from "../index.js";

export interface CodingAgentSessionSetupWriterOptions {
	readonly cwd: string;
	readonly createdAt: number;
	readonly sessionDirectory: string;
	readonly sessionPath: string;
	readonly sessionId: string;
	readonly parentSession?: string;
	readonly onSnapshotChanged?: (snapshot: CodingAgentSessionSetupSnapshot) => void;
}

export interface CodingAgentSessionSetupSnapshot {
	readonly entries: readonly CodingAgentSessionEntry[];
	readonly activeLeafId: string | null;
	readonly name?: string;
}

/** In-memory extension setup view for a native, file-backed Conversation target. */
export class CodingAgentSessionSetupWriter implements ExtensionSessionWriter {
	private readonly header: CodingAgentSessionHeader;
	private readonly entries: CodingAgentSessionEntry[] = [];
	private readonly byId = new Map<string, CodingAgentSessionEntry>();
	private readonly labels = new Map<string, string>();
	private leafId: string | null = null;

	constructor(private readonly options: CodingAgentSessionSetupWriterOptions) {
		this.header = {
			type: "session",
			version: CODING_AGENT_SESSION_VIEW_VERSION,
			id: options.sessionId,
			timestamp: new Date(options.createdAt).toISOString(),
			cwd: options.cwd,
			parentSession: options.parentSession,
		};
	}

	getCwd(): string {
		return this.options.cwd;
	}

	getSessionDir(): string {
		return this.options.sessionDirectory;
	}

	getSessionId(): string {
		return this.header.id;
	}

	getSessionFile(): string {
		return this.options.sessionPath;
	}

	getLeafId(): string | null {
		return this.leafId;
	}

	getLeafEntry(): CodingAgentSessionEntry | undefined {
		return this.leafId ? this.byId.get(this.leafId) : undefined;
	}

	getEntry(id: string): CodingAgentSessionEntry | undefined {
		return this.byId.get(id);
	}

	getLabel(id: string): string | undefined {
		return this.labels.get(id);
	}

	getBranch(fromId?: string): CodingAgentSessionEntry[] {
		return readCodingAgentSessionBranch(this.entries, fromId ?? this.leafId);
	}

	getHeader(): CodingAgentSessionHeader {
		return this.header;
	}

	getEntries(): CodingAgentSessionEntry[] {
		return [...this.entries];
	}

	getTree(): CodingAgentSessionTreeNode[] {
		return projectCodingAgentSessionTree(this.entries, this.labels);
	}

	getSessionName(): string | undefined {
		for (let index = this.entries.length - 1; index >= 0; index -= 1) {
			const entry = this.entries[index];
			if (entry?.type === "session_info" && entry.name) return entry.name;
		}
		return undefined;
	}

	appendMessage(message: AgentMessage): string {
		return this.append({ type: "message", ...this.entryBase(), message });
	}

	appendThinkingLevelChange(thinkingLevel: string): string {
		return this.append({ type: "thinking_level_change", ...this.entryBase(), thinkingLevel });
	}

	appendToolTiming(
		toolCallId: string,
		toolName: string,
		startedAt: number,
		durationMs: number,
		phases: ToolPhase[],
	): string {
		return this.append({
			type: "tool_timing",
			...this.entryBase(),
			toolCallId,
			toolName,
			startedAt,
			durationMs,
			phases,
		});
	}

	appendModelChange(provider: string, modelId: string): string {
		return this.append({ type: "model_change", ...this.entryBase(), provider, modelId });
	}

	appendCompaction<T = unknown>(
		summary: string,
		firstKeptEntryId: string,
		tokensBefore: number,
		details?: T,
		fromHook?: boolean,
	): string {
		return this.append({
			type: "compaction",
			...this.entryBase(),
			summary,
			firstKeptEntryId,
			tokensBefore,
			details,
			fromHook,
		});
	}

	appendCustomEntry(customType: string, data?: unknown): string {
		return this.append({ type: "custom", ...this.entryBase(), customType, data });
	}

	appendSessionInfo(name: string): string {
		return this.append({ type: "session_info", ...this.entryBase(), name: name.trim() });
	}

	appendCustomMessageEntry<T = unknown>(
		customType: string,
		content: string | (TextContent | ImageContent)[],
		display: boolean,
		details?: T,
	): string {
		return this.append({ type: "custom_message", ...this.entryBase(), customType, content, display, details });
	}

	branch(branchFromId: string): void {
		this.requireEntry(branchFromId);
		this.leafId = branchFromId;
	}

	resetLeaf(): void {
		this.leafId = null;
	}

	branchWithSummary(branchFromId: string | null, summary: string, details?: unknown, fromHook?: boolean): string {
		if (branchFromId) this.requireEntry(branchFromId);
		this.leafId = branchFromId;
		return this.append({
			type: "branch_summary",
			...this.entryBase(),
			fromId: branchFromId ?? "root",
			summary,
			details,
			fromHook,
		});
	}

	appendLabelChange(targetId: string, label: string | undefined): string {
		this.requireEntry(targetId);
		const id = this.append({ type: "label", ...this.entryBase(), targetId, label });
		if (label) this.labels.set(targetId, label);
		else this.labels.delete(targetId);
		return id;
	}

	private entryBase(): { readonly id: string; readonly parentId: string | null; readonly timestamp: string } {
		return { id: this.createEntryId(), parentId: this.leafId, timestamp: new Date().toISOString() };
	}

	private append(entry: CodingAgentSessionEntry): string {
		this.entries.push(entry);
		this.byId.set(entry.id, entry);
		this.leafId = entry.id;
		this.options.onSnapshotChanged?.({
			entries: this.entries,
			activeLeafId: this.leafId,
			name: this.getSessionName(),
		});
		return entry.id;
	}

	private requireEntry(id: string): void {
		if (!this.byId.has(id)) throw new Error(`Entry ${id} not found`);
	}

	private createEntryId(): string {
		for (let attempt = 0; attempt < 100; attempt += 1) {
			const id = randomUUID().slice(0, 8);
			if (!this.byId.has(id)) return id;
		}
		return randomUUID();
	}
}
