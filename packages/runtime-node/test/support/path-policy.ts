import { resolve, sep } from "node:path";
import type { EditPathPolicy, WritePathPolicy } from "../../src/coding/index.js";

interface TestPathPolicyOptions {
	readonly cwd: string;
	readonly knowledgeRoot: string;
}

export function createTestEditPathPolicy(options: TestPathPolicyOptions): EditPathPolicy {
	return createTestPathPolicy(options, "edit");
}

export function createTestWritePathPolicy(options: TestPathPolicyOptions): WritePathPolicy {
	return createTestPathPolicy(options, "write");
}

function createTestPathPolicy(
	options: TestPathPolicyOptions,
	tool: "edit" | "write",
): EditPathPolicy | WritePathPolicy {
	const protectedDirectories = [resolve(options.cwd, ".vetta", "skills"), resolve(options.cwd, ".agents", "skills")];
	const wikiDirectory = resolve(options.knowledgeRoot, "wiki");
	return {
		getRejectionReason(absolutePath) {
			if (protectedDirectories.some((directory) => isPathInside(absolutePath, directory))) {
				return `"${absolutePath}" is inside a skill/scene directory which is read-only.`;
			}
			if (isPathInside(absolutePath, wikiDirectory)) {
				return tool === "write"
					? `"${absolutePath}" is managed exclusively by the kb_write_page tool.`
					: `"${absolutePath}" is managed exclusively by kb_write_page.`;
			}
			return undefined;
		},
	};
}

function isPathInside(path: string, directory: string): boolean {
	const resolvedPath = resolve(path);
	const resolvedDirectory = resolve(directory);
	return resolvedPath === resolvedDirectory || resolvedPath.startsWith(`${resolvedDirectory}${sep}`);
}
