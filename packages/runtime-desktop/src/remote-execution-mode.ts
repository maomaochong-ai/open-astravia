import type { SessionExecutionMode } from "@vetta/runtime-core";
import { isSshProjectUri } from "@vetta/ssh-transport";

/**
 * 远程项目的执行模式。
 *
 * 沙箱（seatbelt / bubblewrap / Windows sandbox host）约束的是**本机**进程，对经 SSH 在
 * 另一台机器上执行的命令不起任何作用。远程会话因此只有一种诚实的模式：完全访问。
 *
 * 不能把 `sandbox` 原样放进去：沙箱模式的读写与命令工具由本机沙箱工具集提供，远程会话
 * 没有这套工具集，结果是四个核心工具整组消失且没有任何报错——用户默认开着沙箱时，远程
 * 项目里的 Agent 既不能读也不能写，却看不出为什么。
 */
export function resolveProjectExecutionMode(
	cwd: string | undefined,
	requested: SessionExecutionMode | undefined,
): SessionExecutionMode | undefined {
	return cwd !== undefined && isSshProjectUri(cwd) ? "full-access" : requested;
}

export const REMOTE_SANDBOX_UNSUPPORTED_MESSAGE =
	"Sandbox mode is not available for remote projects: the sandbox only constrains processes on this computer, " +
	"and commands in a remote project run on the remote machine.";

/** 会话中途切换模式时用：对远程会话请求沙箱必须明确失败，而不是假装切过去了。 */
export function assertProjectSupportsExecutionMode(cwd: string | undefined, mode: SessionExecutionMode): void {
	if (mode === "sandbox" && cwd !== undefined && isSshProjectUri(cwd)) {
		throw new Error(REMOTE_SANDBOX_UNSUPPORTED_MESSAGE);
	}
}
