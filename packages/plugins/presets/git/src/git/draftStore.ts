import { readJsonFile, writeJsonFile } from "@vetta-org/plugin-sdk";
import { getStorageApi } from "./runtime";

/** Plugin-private file holding unsent commit messages, keyed by repo root. */
const DRAFTS_PATH = "commit-drafts.json";

type Drafts = Record<string, string>;

async function readDrafts(): Promise<Drafts> {
	try {
		return (await readJsonFile<Drafts>(getStorageApi(), DRAFTS_PATH)) ?? {};
	} catch {
		// A corrupt or unreadable draft file must never block committing.
		return {};
	}
}

/** The saved message for a repository, or an empty string when there is none. */
export async function loadDraft(root: string): Promise<string> {
	const drafts = await readDrafts();
	return drafts[root] ?? "";
}

/**
 * Persist (or clear) a repository's unsent message.
 *
 * Plugin storage is global rather than per-project, so the repo root is the key.
 * Empty messages delete their entry instead of accumulating blanks forever.
 */
export async function saveDraft(root: string, message: string): Promise<void> {
	const drafts = await readDrafts();
	if (message.trim().length === 0) {
		if (!(root in drafts)) return;
		delete drafts[root];
	} else {
		if (drafts[root] === message) return;
		drafts[root] = message;
	}
	try {
		await writeJsonFile(getStorageApi(), DRAFTS_PATH, drafts);
	} catch {
		// Losing a draft is a nuisance; failing the user's action over it is worse.
	}
}
