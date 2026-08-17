import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import lockfile from "proper-lockfile";

/** File-backed text storage keyed by a caller-owned scope type. */
export class NodeScopedTextStorage<Scope extends string> {
	constructor(private readonly paths: Readonly<Record<Scope, string>>) {}

	withLock(scope: Scope, operation: (current: string | undefined) => string | undefined): void {
		const path = this.paths[scope];
		const directory = dirname(path);
		let release: (() => void) | undefined;
		try {
			const fileExists = existsSync(path);
			if (fileExists) release = lockfile.lockSync(path, { realpath: false });
			const current = fileExists ? readFileSync(path, "utf-8") : undefined;
			const next = operation(current);
			if (next === undefined) return;
			if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
			if (!release) release = lockfile.lockSync(path, { realpath: false });
			writeFileSync(path, next, "utf-8");
		} finally {
			release?.();
		}
	}
}
