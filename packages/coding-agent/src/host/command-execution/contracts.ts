export interface HostBashExecutionOptions {
	readonly onChunk?: (chunk: string) => void;
	readonly signal?: AbortSignal;
}

export interface HostBashOperationOptions {
	readonly onData: (data: Buffer) => void;
	readonly signal?: AbortSignal;
	readonly timeout?: number;
	readonly env?: NodeJS.ProcessEnv;
}

export interface HostBashOperations {
	exec(command: string, cwd: string, options: HostBashOperationOptions): Promise<{ readonly exitCode: number | null }>;
}

export interface HostBashResult {
	readonly output: string;
	readonly exitCode: number | undefined;
	readonly cancelled: boolean;
	readonly truncated: boolean;
	readonly fullOutputPath?: string;
}

/** 宿主提供的用户 Bash 执行能力；RPC 和 SDK 只依赖此合同。 */
export interface HostBashExecutor {
	execute(command: string, options?: HostBashExecutionOptions): Promise<HostBashResult>;
	executeWithOperations(
		command: string,
		cwd: string,
		operations: HostBashOperations,
		options?: HostBashExecutionOptions,
	): Promise<HostBashResult>;
}
