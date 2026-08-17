export interface ForegroundCommandOperations {
	exec(
		command: string,
		cwd: string,
		options: {
			readonly onData: (data: Uint8Array) => void;
			readonly signal?: AbortSignal;
			readonly timeout?: number;
			readonly env?: Readonly<Record<string, string | undefined>>;
		},
	): Promise<{ readonly exitCode: number | null }>;
}
