/**
 * 进程执行端口。
 *
 * 把「真的 spawn 一个 ssh」隔在接口后面，是为了让命令构造、输出解析、错误分类这些
 * 真正容易出错的逻辑可以在没有 SSH 服务器的情况下测试。生产实现只有一个，见
 * {@link createNodeSshProcessRunner}。
 */

export interface SshProcessInvocation {
	readonly argv: readonly string[];
	/** 写入 stdin 后立刻关闭。用于把文件内容推给远端的 `base64 -d`。 */
	readonly stdin?: Uint8Array;
	/** 增量 stdout。给出时表示调用方要流式消费，实现仍会累积一份完整结果。 */
	readonly onStdout?: (chunk: Uint8Array) => void;
	readonly onStderr?: (chunk: Uint8Array) => void;
	readonly signal?: AbortSignal;
	readonly timeoutMs?: number;
	/** 追加到子进程的环境变量。用于挂 askpass。 */
	readonly env?: Readonly<Record<string, string>>;
}

export interface SshProcessResult {
	/** 进程被信号杀死时为 null——此时不能断言远端命令的结果，见 ADR-0124。 */
	readonly exitCode: number | null;
	readonly stdout: Uint8Array;
	readonly stderr: string;
	/** 因超时或 AbortSignal 终止。与「远端命令返回非零」是不同性质的失败。 */
	readonly aborted: boolean;
	/** `aborted` 的原因是 `timeoutMs` 到点，而不是 AbortSignal。 */
	readonly timedOut?: boolean;
}

export interface SshProcessRunner {
	run(invocation: SshProcessInvocation): Promise<SshProcessResult>;
}

/** `ssh` 自身的退出码。255 是 OpenSSH 用来表示「连接层失败」的保留值。 */
export const SSH_TRANSPORT_FAILURE_EXIT_CODE = 255;
