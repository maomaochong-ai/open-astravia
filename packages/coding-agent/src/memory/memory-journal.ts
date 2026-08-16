import type { AssistantMessage } from "@vetta/ai";
import type { MemoryTextStorage } from "./memory-storage.js";

const MAX_LINE_TEXT = 200;
const MAX_SECTION_CHARS = 2_000;
const FILE_ARGUMENT_KEYS = ["path", "file_path", "filePath", "output", "outputPath"] as const;

export interface MemoryJournal {
	appendTurn(cwd: string, message: AssistantMessage): void;
	appendRollover(cwd: string, summary: string): void;
}

export interface MemoryJournalOptions {
	readonly now?: () => Date;
}

export class MemoryJournalWriter implements MemoryJournal {
	private readonly now: () => Date;

	constructor(
		private readonly storage: MemoryTextStorage,
		options: MemoryJournalOptions = {},
	) {
		this.now = options.now ?? (() => new Date());
	}

	appendTurn(_cwd: string, message: AssistantMessage): void {
		try {
			if (message.stopReason === "aborted" || message.stopReason === "error") return;
			const text = collapse(
				message.content
					.filter((block): block is { type: "text"; text: string } => block.type === "text")
					.map((block) => block.text)
					.join(" "),
			);
			const files = filesTouched(message);
			if (!text && files.length === 0) return;
			const { date, time } = dateParts(this.now());
			ensureHeader(this.storage, date);
			const truncated = text.length > MAX_LINE_TEXT ? `${text.slice(0, MAX_LINE_TEXT)}…` : text;
			const filesPart = files.length > 0 ? ` — files: ${files.join(", ")}` : "";
			this.storage.append(`- ${time} ${truncated}${filesPart}\n`);
		} catch {
			// JOURNAL 是观察性副作用，失败不能改变 Turn 结果。
		}
	}

	appendRollover(_cwd: string, summary: string): void {
		try {
			const body = summary.length > MAX_SECTION_CHARS ? `${summary.slice(0, MAX_SECTION_CHARS)}…` : summary;
			if (!body.trim()) return;
			const { date, time } = dateParts(this.now());
			ensureHeader(this.storage, date);
			this.storage.append(`\n## Rollover @ ${time}\n\n${body}\n`);
		} catch {
			// rollover 日志同样是 best-effort。
		}
	}
}

function dateParts(date: Date): { readonly date: string; readonly time: string } {
	return {
		date: `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`,
		time: `${pad2(date.getHours())}:${pad2(date.getMinutes())}`,
	};
}

function pad2(value: number): string {
	return value < 10 ? `0${value}` : String(value);
}

function ensureHeader(storage: MemoryTextStorage, date: string): void {
	if (storage.read() === undefined) storage.append(`# Work log — ${date}\n\n`);
}

function collapse(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function filesTouched(message: AssistantMessage): string[] {
	const files = new Set<string>();
	for (const block of message.content) {
		if (block.type !== "toolCall") continue;
		const input = block.arguments as Record<string, unknown> | undefined;
		if (!input) continue;
		for (const key of FILE_ARGUMENT_KEYS) {
			const value = input[key];
			if (typeof value === "string" && value.trim()) files.add(value.trim());
		}
	}
	return [...files];
}
