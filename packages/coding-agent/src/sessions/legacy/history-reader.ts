import type { HistoryEntry, RuntimeSessionFileHistoryReader } from "@vetta/runtime-core";
import { branchFromFileEntries, entriesToHistory } from "../projection/session-history.js";
import { parseCodingAgentLegacySessionDocument } from "./document.js";
import { isLegacySessionHeader } from "./header-reader.js";
import type { LegacySessionFileHost } from "./host-contracts.js";

/** 将旧 Coding Agent JSONL 直接投影为 Runtime History；不创建 AgentSession。 */
export class LegacyRuntimeSessionFileHistoryReader implements RuntimeSessionFileHistoryReader {
	constructor(private readonly host: LegacySessionFileHost) {}

	canRead(sessionPath: string): boolean {
		try {
			return isLegacySessionHeader(this.host.readFirstLineSync(sessionPath));
		} catch {
			return false;
		}
	}

	read(sessionPath: string): { history: HistoryEntry[] } {
		const document = parseCodingAgentLegacySessionDocument(this.host.readText(sessionPath));
		const branch = branchFromFileEntries([document.header, ...document.entries]);
		return { history: entriesToHistory(branch, { allEntries: [...document.entries] }) };
	}
}
