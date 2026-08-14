import type { PluginFsApi } from "@vetta-org/plugin-sdk";

/** Screenshots live beside the design sources, one flat directory per design. */
const SNAPSHOTS_DIR = ".snapshots";

/** Kept per frame on disk; older ones are deleted on write. */
const MAX_PER_FRAME = 20;

const FILE_NAME = /^(.+)-(\d+)\.png$/;

export interface Snapshot {
	path: string;
	capturedAt: number;
}

/**
 * Frame ids may contain hyphens (`login-form`), so the timestamp suffix is
 * stripped and the remainder compared exactly — a prefix match would let
 * `login` swallow `login-form`'s screenshots.
 */
function parseFileName(name: string): { frameId: string; capturedAt: number } | null {
	const match = FILE_NAME.exec(name);
	if (!match) return null;
	return { frameId: match[1] as string, capturedAt: Number(match[2]) };
}

export function snapshotPath(dirPath: string, frameId: string, capturedAt: number): string {
	return `${dirPath}/${SNAPSHOTS_DIR}/${frameId}-${capturedAt}.png`;
}

/** This frame's screenshots, newest first. Missing/unreadable directory = none. */
export async function listSnapshots(fs: PluginFsApi, dirPath: string, frameId: string): Promise<Snapshot[]> {
	let entries: Awaited<ReturnType<PluginFsApi["readDir"]>>;
	try {
		entries = await fs.readDir(`${dirPath}/${SNAPSHOTS_DIR}`);
	} catch {
		return [];
	}
	const snapshots: Snapshot[] = [];
	for (const entry of entries) {
		if (entry.isDirectory) continue;
		const parsed = parseFileName(entry.name);
		if (parsed?.frameId === frameId) snapshots.push({ path: entry.path, capturedAt: parsed.capturedAt });
	}
	return snapshots.sort((a, b) => b.capturedAt - a.capturedAt);
}

/** Delete this frame's screenshots beyond {@link MAX_PER_FRAME} (newest kept). */
export async function pruneSnapshots(fs: PluginFsApi, dirPath: string, frameId: string): Promise<void> {
	const stale = (await listSnapshots(fs, dirPath, frameId)).slice(MAX_PER_FRAME);
	for (const snapshot of stale) {
		try {
			await fs.delete(snapshot.path);
		} catch {
			// A screenshot that can't be deleted is not worth failing the capture over.
		}
	}
}

// `.gitignore` 的维护移到 vetd/design-ignore.ts：要忽略的早已不止截图，且必须
// 幂等补齐（老设计的 .gitignore 里没有 .history/，「已有就不重写」会让它永远缺）。
