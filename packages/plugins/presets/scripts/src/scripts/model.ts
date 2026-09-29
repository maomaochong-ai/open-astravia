export type ScriptSource = "package.json" | "makefile";

export type PackageManager = "bun" | "pnpm" | "yarn" | "npm";

/** 一条可以运行的脚本：点一下就在 `dir` 里敲 `command`。 */
export interface RunnableScript {
	/** 全局唯一：同一目录下 package.json 的 `dev` 与 Makefile 的 `dev` 不能撞。 */
	readonly key: string;
	readonly name: string;
	readonly source: ScriptSource;
	/** 列表里的次要文字：npm 脚本的原始命令，或 Makefile target 的 `##` 说明。 */
	readonly detail?: string;
	readonly command: string;
	readonly dir: string;
}

/** 一个项目 = 一个含 package.json 或 Makefile 的目录。 */
export interface ScriptProject {
	/** 绝对路径或 `ssh://` 路径，也是终端的 cwd。 */
	readonly dir: string;
	/** 相对扫描根的路径，根目录为空串；用 `/` 分隔。 */
	readonly relDir: string;
	/** package.json 的 `name`，没有就是空。 */
	readonly packageName?: string;
	readonly packageManager?: PackageManager;
	readonly scripts: readonly RunnableScript[];
}
