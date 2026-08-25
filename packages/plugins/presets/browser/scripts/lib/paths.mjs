import { homedir } from "node:os";
import { join } from "node:path";

/**
 * wrapper 跑在宿主 spawn 的独立进程里，拿不到 `ctx.storage`，只能自己算出插件数据目录。
 * 这里刻意复刻 `@vetta/action-rpc` 的解析链（VETTA_HOME → ~/<VETTA_CONFIG_DIR|.vetta>），
 * 否则开发态用 VETTA_CONFIG_DIR 隔离环境时 wrapper 会读到生产目录。
 *
 * 宿主 spawn MCP server 时透传整个 process.env（runtime-node 的 stdio transport 用
 * `{ ...process.env, ...config.env }`），所以这两个变量在 wrapper 里一定可见。
 */

const PLUGIN_ID = "browser";

/** ~/.vetta（或被 VETTA_HOME / VETTA_CONFIG_DIR 覆盖后的根）。 */
export function vettaHomeDir(env = process.env, home = homedir()) {
	const explicit = env.VETTA_HOME;
	if (explicit) return expandTilde(explicit, home);
	return join(home, env.VETTA_CONFIG_DIR || ".vetta");
}

function expandTilde(value, home) {
	if (value === "~") return home;
	if (value.startsWith("~/") || value.startsWith("~\\")) return join(home, value.slice(2));
	return value;
}

/** ~/.vetta/plugin-data/browser —— 与宿主 `ctx.storage` 的物理目录一致。 */
export function pluginDataDir(env = process.env, home = homedir()) {
	return join(vettaHomeDir(env, home), "plugin-data", PLUGIN_ID);
}

/** renderer 物化、wrapper 读取的 agent-browser 配置文件。 */
export function agentBrowserConfigPath(env = process.env, home = homedir()) {
	return join(pluginDataDir(env, home), "agent-browser.json");
}

/** 独占 profile 目录（Chrome 的 --user-data-dir）。 */
export function browserProfileDir(env = process.env, home = homedir()) {
	return join(pluginDataDir(env, home), "profile");
}

/** action-policy 文件；`--action-policy` 收的是路径而不是内联类别。 */
export function actionPolicyPath(env = process.env, home = homedir()) {
	return join(pluginDataDir(env, home), "action-policy.json");
}

/**
 * 只属于本插件的 wrapper 运行时参数（当前只有 `--tools`）。
 * 刻意与 `agent-browser.json` 分开：那份文件必须严格保持上游 schema，
 * 混入我们自己的键会在上游收紧校验时把整个 MCP server 打挂。
 */
export function wrapperRuntimePath(env = process.env, home = homedir()) {
	return join(pluginDataDir(env, home), "runtime.json");
}

/**
 * 宿主托管 npm 的全局 bin 目录。插件的安装步骤把 agent-browser 装在这里，
 * 解析二进制时优先看这个目录，好让插件装的那一份稳定赢过用户机器上可能存在的旧版全局安装。
 * 目录布局与宿主 `runtimes/paths.ts` 的 `npmGlobalBinDir()` 一致（win 在 prefix 根，unix 在 bin/）。
 */
export function managedNpmGlobalBinDir(env = process.env, home = homedir()) {
	const prefix = join(vettaHomeDir(env, home), "runtimes", ".npm-global");
	return process.platform === "win32" ? prefix : join(prefix, "bin");
}
