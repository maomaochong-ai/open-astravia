import type { HistoryEntry, RuntimeSessionFileHistoryReader } from "@vetta/runtime-core";
import { branchFromFileEntries, entriesToHistory } from "../projection/session-history.js";
import { readCodingAgentLegacySessionDocument } from "./document.js";
import { isLegacySessionFileSync } from "./header-reader.js";

/** 将旧 Coding Agent JSONL 直接投影为 Runtime History；不创建 AgentSession。 */
export class LegacyRuntimeSessionFileHistoryReader implements RuntimeSessionFileHistoryReader {
	canRead(sessionPath: string): boolean {
		return isLegacySessionFileSync(sessionPath);
	}

	read(sessionPath: string): { history: HistoryEntry[] } {
		const document = readCodingAgentLegacySessionDocument(sessionPath);
		const branch = branchFromFileEntries([document.header, ...document.entries]);
		return { history: entriesToHistory(branch, { allEntries: [...document.entries] }) };
	}
}
