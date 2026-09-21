/**
 * 一个已经跑起来的伪终端。本地由 node-pty 提供，远程由 SSH helper 提供，
 * 会话层只依赖这个接口，不关心命令到底在哪台机器上执行。
 */
export interface TerminalBackend {
	write(data: string): void;
	resize(cols: number, rows: number): void;
	/**
	 * 前台进程名。**不可观察时返回 undefined**，不要用启动 shell 名冒充——
	 * 关闭确认会读它，猜错的方向是「用户以为没东西在跑」。
	 */
	foregroundProcess(): string | undefined;
	kill(): void;
	onData(listener: (chunk: string) => void): () => void;
	onExit(listener: (event: TerminalExitEvent) => void): () => void;
}

export interface TerminalExitEvent {
	readonly exitCode: number | null;
	readonly signal?: number;
}

export interface OpenTerminalBackendOptions {
	/** 本地绝对路径，或 `ssh://<hostId>/<path>`；由 service 解析后分发到对应 backend。 */
	readonly cwd: string;
	readonly cols: number;
	readonly rows: number;
	/** 用户在设置里指定的 shell，缺省由各 backend 自行解析。 */
	readonly shellPath?: string;
}

export interface TerminalBackendFactory {
	open(options: OpenTerminalBackendOptions): Promise<TerminalBackend>;
}
