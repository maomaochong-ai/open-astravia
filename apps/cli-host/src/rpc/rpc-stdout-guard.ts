export interface RpcStdoutGuard {
	restore(): void;
}

/**
 * RPC stdout 只允许由 wire transport 写入 JSONL。
 *
 * Coding Agent 的动态资源仍可能使用 console.log/info/debug 输出诊断，因此专用
 * sidecar 入口把这些 console 通道重定向到 stderr；process.stdout.write 保持不变。
 */
export function installRpcStdoutGuard(): RpcStdoutGuard {
	const originalLog = console.log;
	const originalInfo = console.info;
	const originalDebug = console.debug;
	const redirect = (...data: unknown[]): void => console.error(...data);

	console.log = redirect;
	console.info = redirect;
	console.debug = redirect;

	return {
		restore() {
			console.log = originalLog;
			console.info = originalInfo;
			console.debug = originalDebug;
		},
	};
}
