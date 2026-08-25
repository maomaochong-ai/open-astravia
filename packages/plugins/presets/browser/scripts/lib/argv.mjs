/**
 * 拼装 `agent-browser ... mcp ...` 的命令行。纯函数，无 I/O，由单测覆盖。
 *
 * 分工：能进配置文件的（headed / profile / autoConnect / pinTab / maxOutput /
 * contentBoundaries / actionPolicy）一律走 `--config`，只有**每进程都不同**的项才上命令行。
 * 这样 renderer 改设置只需重写一个文件，不必让 wrapper 理解设置语义。
 */

/**
 * 每个宿主 Agent 会话都会 spawn 一个独立的 wrapper 进程，所以 session id 在这里生成即可
 * 「每对话一个钉住的 tab」。加前缀是为了让用户在 `agent-browser session list` 里认得出
 * 哪些会话来自 Vetta，而不是自己在终端里开的。
 */
export const SESSION_PREFIX = "vetta-";

export function buildSessionId(random = Math.random) {
	return `${SESSION_PREFIX}${Math.floor(random() * 0xffffffff).toString(36)}${Date.now().toString(36)}`;
}

/**
 * @param {{ configPath: string; sessionId: string; toolsProfile: string }} input
 * @returns {string[]} argv（不含可执行文件名）
 */
export function buildMcpArgv(input) {
	const tools = input.toolsProfile.trim() || "core";
	return [
		"--config",
		input.configPath,
		"--session",
		input.sessionId,
		// 同一个 Chrome 里多个会话并行时，钉住各自的 tab，避免互相抢导航。
		// 配置文件里也写了 pinTab，这里显式再给一次，确保旧配置文件也拿到严格语义。
		"--pin-tab",
		"mcp",
		"--tools",
		tools,
	];
}
