import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * agent-browser 的 session 名派生。
 *
 * 每次调用都是一个全新的 shim 进程，进程自身没有任何会话身份；宿主也不会往 bash 的 spawn
 * 环境里注入对话 id。所以身份只能来自**工作目录**：同一个项目下的所有调用落到同一个
 * session，于是浏览器、登录态与钉住的标签页在整个任务里是连续的。
 *
 * 代价是同一项目下的两个对话共享同一个标签页，可能互相抢导航。这是刻意接受的取舍：
 * 备选方案（让模型自己保管 session 名）会把这个不变量交给模型自觉，更不可靠。
 *
 * 用 workspace 根而不是 cwd：模型经常在子目录里执行命令，按 cwd 会在同一个项目里裂出
 * 好几个浏览器。
 */

const SESSION_PREFIX = "vetta-";

/** 向上找 workspace 根（.git 优先，其次 package.json）；找不到就用 cwd 自己。 */
export function resolveWorkspaceRoot(cwd, exists = existsSync) {
	let current = resolve(cwd);
	for (;;) {
		if (exists(`${current}/.git`)) return current;
		const parent = dirname(current);
		if (parent === current) return resolve(cwd);
		current = parent;
	}
}

/**
 * 由 workspace 根派生稳定的 session 名。
 * 加 `vetta-` 前缀是为了让用户在 `agent-browser session list` 里认得出哪些会话来自 Vetta，
 * 而不是自己在终端里开的。
 */
export function buildSessionId(cwd, exists = existsSync) {
	const root = resolveWorkspaceRoot(cwd, exists);
	const digest = createHash("sha256").update(root).digest("hex").slice(0, 12);
	return `${SESSION_PREFIX}${digest}`;
}
