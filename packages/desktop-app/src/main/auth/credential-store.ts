/**
 * 把登录凭据下沉到 `~/.vetta/auth.json`，供**客户端进程之外**的消费者读取。
 *
 * 起因：登录态原本只活在 renderer 的 localStorage 与主进程内存里，而 agent-rpc 子
 * 进程、skill 内置脚本（publish-ability）都读不到。让它们去翻 settings.json 又会把
 * 「客户端配置文件的内部结构」变成外部契约。故单独落一份最小契约文件：只有 baseUrl
 * 与 token 两个字段。
 *
 * 消费者一律**按需重读**而不缓存：token 会轮换，这里每次刷新都会覆写本文件，
 * 缓存住就等于把过期凭据钉死在调用方手里。
 *
 * 权限收到 0600：这是有效的访问令牌，不能让同机其它用户直接读走。
 */

import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DEFAULT_SERVER_URL } from "../constants.js";
import { getAppLogger } from "../logger.js";

const log = getAppLogger("auth");

/**
 * 与外部消费者共用的契约，字段只增不改。
 * 现有读方：coding-agent 的 `core/mcp/vetta-credentials.ts`、
 * skill-presets 的 `publish-ability/scripts/publish.mjs`。
 */
interface StoredCredentials {
	baseUrl: string;
	token: string;
}

function credentialsPath(): string {
	const home = process.env.VETTA_HOME?.trim() || join(homedir(), ".vetta");
	return join(home, "auth.json");
}

/**
 * 同步凭据文件。token 为空（登出）时删除文件——留一个失效 token 在盘上没有价值，
 * 只会让 MCP 报出「认证失败」而非更准确的「未登录」。
 *
 * 任何失败都只记日志不抛：凭据下沉是给外部进程用的便利设施，
 * 它坏掉不该连累登录本身。
 */
export function syncCredentialFile(token: string | undefined): void {
	const path = credentialsPath();
	try {
		if (!token) {
			rmSync(path, { force: true });
			return;
		}
		const payload: StoredCredentials = {
			baseUrl: DEFAULT_SERVER_URL.replace(/\/+$/, ""),
			token,
		};
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
		// 文件已存在时 writeFileSync 的 mode 不生效，显式收紧一次
		chmodSync(path, 0o600);
	} catch (error) {
		log.warn("同步 auth.json 失败:", error);
	}
}
