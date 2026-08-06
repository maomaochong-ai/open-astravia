import { createConversationSeedDraft } from "@vetta/runtime-storage/conversation";
import type {
	CodingAgentSessionSeedInitializer,
	CodingAgentSessionSeedTarget,
} from "../../composition/session-host/active-session-transition-contracts.js";
import type { ExtensionSessionSetup } from "../../extensions/index.js";
import { projectCodingAgentSessionDocumentEntry } from "../projection/session-document-entry.js";
import { CodingAgentSessionSetupWriter } from "./session-setup-writer.js";

export type CodingAgentSessionSetup = ExtensionSessionSetup;

export interface CodingAgentSessionSetupSeedInput extends CodingAgentSessionSeedTarget {
	readonly setup: CodingAgentSessionSetup;
}

export function createCodingAgentSessionSetupSeedInitializer(
	setup: CodingAgentSessionSetup,
): CodingAgentSessionSeedInitializer {
	return { initializeSeed: (target) => initializeCodingAgentSessionSetupSeed({ ...target, setup }) };
}

export async function initializeCodingAgentSessionSetupSeed(input: CodingAgentSessionSetupSeedInput): Promise<void> {
	const createdAt = Date.now();
	const draft = await createConversationSeedDraft({
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
		onSnapshotChanged: (snapshot) =>
			draft.update({
				entries: snapshot.entries.map(projectCodingAgentSessionDocumentEntry),
				activeLeafId: snapshot.activeLeafId,
				name: snapshot.name,
			}),
	});
	await input.setup(writer);
}
