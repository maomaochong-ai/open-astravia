/**
 * agent-browser 的版本要求。
 *
 * 插件依赖的不只是「有这个二进制」，还包括 `--config` 的配置键集合与 `--pin-tab` 这类
 * 开关。旧版本上这些开关直接是 `Unknown command`，进程会立刻退出，表现为**工具面整个消失**
 * 而没有任何面向用户的信号——这正是不做版本校验时最难排查的失败。
 *
 * 机器上很可能已经有一个用户自己装的旧版 agent-browser（nvm / brew 全局），它会出现在
 * PATH 上。所以「找得到二进制」不等于「能用」，必须显式比对版本。
 */

/** 插件要求的最低版本；与 runtime-controller 里安装时锁定的版本保持一致。 */
export const MINIMUM_AGENT_BROWSER_VERSION = "0.34.0";

/** 从 `agent-browser --version` 的输出里取出版本号；取不到返回 null。 */
export function parseAgentBrowserVersion(output) {
	if (typeof output !== "string") return null;
	const match = output.match(/(\d+)\.(\d+)\.(\d+)/);
	return match ? match[0] : null;
}

function toParts(version) {
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
	return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/**
 * `version` 是否满足 `minimum`。
 *
 * 版本解析不出来时返回 **false**（fail-closed）：宁可退回引导态让用户重装，也不要拿一个
 * 不确定的二进制去起 MCP server——那会退化成静默失败。
 */
export function isAgentBrowserCompatible(version, minimum = MINIMUM_AGENT_BROWSER_VERSION) {
	const actual = toParts(version ?? "");
	const required = toParts(minimum);
	if (!actual || !required) return false;
	for (let index = 0; index < 3; index++) {
		if (actual[index] > required[index]) return true;
		if (actual[index] < required[index]) return false;
	}
	return true;
}
