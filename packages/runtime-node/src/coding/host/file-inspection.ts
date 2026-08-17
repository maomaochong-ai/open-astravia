import { existsSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";

export interface NodeFileInspectionOperations {
	isAbsolute(path: string): boolean;
	exists(path: string): boolean;
	isFile(path: string): boolean;
}

/** Node implementation for product features that validate a local file before acting on it. */
export function createNodeFileInspectionOperations(): NodeFileInspectionOperations {
	return {
		isAbsolute,
		exists: existsSync,
		isFile: (path) => statSync(path).isFile(),
	};
}
