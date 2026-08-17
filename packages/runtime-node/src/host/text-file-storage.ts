import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

/** Minimal synchronous text storage backed by one Node file. */
export class NodeTextFileStorage {
	constructor(readonly path: string) {}

	read(): string | undefined {
		if (!existsSync(this.path)) return undefined;
		return readFileSync(this.path, "utf8");
	}

	replace(content: string): void {
		const temporaryPath = `${this.path}.tmp`;
		writeFileSync(temporaryPath, content, "utf8");
		renameSync(temporaryPath, this.path);
	}

	append(content: string): void {
		appendFileSync(this.path, content, "utf8");
	}
}
