import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Node 文件系统适配器；工作区事实规则本身由 coding-agent 持有。 */
export const nodeWorkspaceFactsFileSource = Object.freeze({
	exists: (root: string, relativePath: string) => existsSync(join(root, relativePath)),
	readText: (root: string, relativePath: string) => readFileSync(join(root, relativePath), "utf-8"),
});
