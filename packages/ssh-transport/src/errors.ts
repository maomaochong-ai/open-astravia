/**
 * 远端操作的失败分类。
 *
 * 分类本身就是 ADR-0124 执行边界规则的载体：传输层失败**不能**被当成「远端命令失败」，
 * 更不能被当成「远端没有这个文件」。前者是「我们没问到」，后者是「远端回答了没有」。
 * 把两者合并的直接后果是：网络抖一下，文件树就显示目录为空，Agent 就以为文件不存在
 * 并把它重新创建一遍。
 */

/** 连接层失败：没有从远端拿到任何可信答案。 */
export class SshTransportError extends Error {
	/** 固定为 `unverifiable`：无法证明远端命令是否执行、是否成功。 */
	readonly verdict = "unverifiable" as const;

	constructor(
		message: string,
		readonly hostId: string,
		readonly stderr: string,
	) {
		super(message);
		this.name = "SshTransportError";
	}
}

/** 远端确实执行了命令并返回了非零退出码。 */
export class SshRemoteCommandError extends Error {
	readonly verdict = "exited" as const;

	constructor(
		message: string,
		readonly hostId: string,
		readonly exitCode: number,
		readonly stderr: string,
	) {
		super(message);
		this.name = "SshRemoteCommandError";
	}
}

/** 调用方主动取消或超时。同样无法断言远端状态。 */
export class SshOperationAbortedError extends Error {
	readonly verdict = "unverifiable" as const;

	constructor(
		message: string,
		readonly hostId: string,
	) {
		super(message);
		this.name = "SshOperationAbortedError";
	}
}

/**
 * 远程项目的操作落到了本地实现上。
 *
 * 这条错误存在的意义是让「静默回退到本地」变成一次可见的崩溃：本机很可能存在同名
 * 路径，本地执行会对着**完全不同的仓库**给出看起来成功的答案，而用户不会察觉。
 */
export class RemoteProjectNotSupportedError extends Error {
	constructor(operation: string, projectPath: string) {
		super(`Operation "${operation}" does not support remote projects: ${projectPath}`);
		this.name = "RemoteProjectNotSupportedError";
	}
}
