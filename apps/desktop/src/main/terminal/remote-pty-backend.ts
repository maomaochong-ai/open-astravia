import { parseProjectLocation } from "@vetta/ssh-transport/project-uri";
import { mainT } from "../i18n/index.js";
import { getSshConnection } from "../ssh/ssh-runtime.js";
import type { OpenTerminalBackendOptions, TerminalExitEvent } from "./terminal-backend.js";
import type { RemoteTerminalBackendFactory, RemoteTerminalOpenResult } from "./terminal-service.js";

/**
 * 远程项目的终端。命令一律在远端跑——`cwd` 是 `ssh://` URI 时绝不退回本机执行，
 * 那会让用户以为自己在操作远端仓库（ADR-0124）。
 *
 * helper 在就走 `pty.*`（真伪终端、尺寸可变）；helper 不在或版本旧就退回 `ssh -tt`，
 * 此时尺寸固定，这个缺口随 open 一起报给上层，由界面如实告知。
 */
export function createRemotePtyBackendFactory(): RemoteTerminalBackendFactory {
	return {
		async open(options: OpenTerminalBackendOptions): Promise<RemoteTerminalOpenResult> {
			const location = parseProjectLocation(options.cwd);
			if (location.kind !== "ssh") {
				throw new Error(`remote terminal requires an ssh:// cwd, got ${options.cwd}`);
			}
			const connection = getSshConnection(location.hostId);
			const session = await connection.openPty({
				cwd: location.remotePath,
				cols: options.cols,
				rows: options.rows,
				shell: options.shellPath,
			});
			return {
				degraded: !session.canResize,
				backend: {
					write: (data) => session.write(data),
					resize: (cols, rows) => session.resize(cols, rows),
					// 远端前台进程问不出来：不猜，返回 undefined 让关闭确认走保守分支。
					foregroundProcess: () => undefined,
					kill: () => session.close(),
					onData: (listener) =>
						session.onData((chunk, dropped) => {
							// 远端积压超限时丢了块：如实说一句，否则输出会无声跳段。
							if (dropped > 0) listener(`\r\n${mainT("terminal.remoteOutputDropped", { bytes: dropped })}\r\n`);
							listener(chunk);
						}),
					onExit: (listener: (event: TerminalExitEvent) => void) =>
						session.onExit(({ exitCode }) => listener({ exitCode })),
				},
			};
		},
	};
}
