export const CODING_AGENT_SESSION_ID_ENV = "VETTA_AGENT_SESSION_ID";

/**
 * 把宿主已经确认的 Session identity 注入命令环境。
 *
 * CLI 型能力需要跨多次短命令复用自己的外部进程状态，但不能从 cwd 推导身份，
 * 否则同一工作区中的多个 Agent Session 会互相抢占。宿主值最后写入，调用方
 * 不能通过自定义 env 把命令绑定到另一个 Session。
 */
export function createCodingAgentSessionCommandEnvironment(
	sessionId: string,
	environment?: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
	if (!sessionId.trim()) throw new Error("Coding Agent command environment requires a session id");
	return { ...environment, [CODING_AGENT_SESSION_ID_ENV]: sessionId };
}
