import type { ConversationDocument, ConversationDocumentEntry } from "@vetta/runtime-core/conversation";
import type { ExtensionSessionSetup } from "../../extensions/index.js";
import type {
	CodingAgentSessionSeedInitializer,
	CodingAgentSessionSeedTarget,
} from "../../host/session-transition/contracts.js";
import { projectCodingAgentSessionDocumentEntry } from "../projection/session-document-entry.js";
import { CodingAgentSessionSetupWriter } from "./session-setup-writer.js";

export type CodingAgentSessionSetup = ExtensionSessionSetup;

export interface CodingAgentSessionSetupSeedInput extends CodingAgentSessionSeedTarget {
	readonly setup: CodingAgentSessionSetup;
}

export interface CodingAgentSessionSetupHost {
	readonly createEntryId: () => string;
	readonly now: () => number;
	createSeedDraft(options: {
		readonly targetRootDir: string;
		readonly targetSessionId: string;
		readonly createdAt: number;
		readonly cwd?: string;
		readonly parentSessionPath?: string;
	}): Promise<{
		readonly targetPath: string;
		update(snapshot: {
			readonly entries: readonly ConversationDocumentEntry[];
			readonly activeLeafId: string | null;
			readonly name?: string;
		}): ConversationDocument;
	}>;
}

export function createCodingAgentSessionSetupSeedInitializer(
	setup: CodingAgentSessionSetup,
	host: CodingAgentSessionSetupHost,
): CodingAgentSessionSeedInitializer {
	return { initializeSeed: (target) => initializeCodingAgentSessionSetupSeed({ ...target, setup }, host) };
}

export async function initializeCodingAgentSessionSetupSeed(
	input: CodingAgentSessionSetupSeedInput,
	host: CodingAgentSessionSetupHost,
): Promise<void> {
	const createdAt = host.now();
	const draft = await host.createSeedDraft({
		targetRootDir: input.targetRootDir,
		targetSessionId: input.targetSessionId,
		createdAt,
		cwd: input.cwd,
		parentSessionPath: input.parentSession,
	});
	const writer = new CodingAgentSessionSetupWriter({
		cwd: input.cwd,
		createdAt,
		sessionDirectory: input.targetRootDir,
		sessionPath: draft.targetPath,
		sessionId: input.targetSessionId,
		parentSession: input.parentSession,
		createEntryId: host.createEntryId,
		onSnapshotChanged: (snapshot) =>
			draft.update({
				entries: snapshot.entries.map(projectCodingAgentSessionDocumentEntry),
				activeLeafId: snapshot.activeLeafId,
				name: snapshot.name,
			}),
	});
	await input.setup(writer);
}
