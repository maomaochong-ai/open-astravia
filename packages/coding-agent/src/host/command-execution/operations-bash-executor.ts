import { BashOutputCollector } from "./bash-output-collector.js";
import type { HostBashExecutionOptions, HostBashOperations, HostBashResult } from "./contracts.js";

export async function executeHostBashWithOperations(
	command: string,
	cwd: string,
	operations: HostBashOperations,
	options?: HostBashExecutionOptions,
): Promise<HostBashResult> {
	const output = new BashOutputCollector(options);
	try {
		const result = await operations.exec(command, cwd, {
			onData: (data) => output.accept(data),
			signal: options?.signal,
		});
		const cancelled = options?.signal?.aborted ?? false;
		return output.finish(result.exitCode ?? undefined, cancelled);
	} catch (error) {
		if (options?.signal?.aborted) return output.finish(undefined, true);
		output.close();
		throw error;
	}
}
