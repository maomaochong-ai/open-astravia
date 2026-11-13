import { readFile } from "node:fs/promises";
import { parentPort } from "node:worker_threads";
import type { HistoryEntry } from "@astravia/runtime-core";
import { projectSessionFileText } from "./file-conversation-session-services.js";

/**
 * 会话历史解析的 worker 入口。
 *
 * 主进程里这份解析是同步纯计算：4 MB 会话约 190 ms、20 MB 约 1.5 s，期间所有窗口的
 * IPC 一起停摆。把它挪到线程外的唯一代价是一次 structured clone，而这条路本来就只
 * 用来「看一份历史」。
 *
 * 协议刻意做成一次请求一次响应：调用方为每个请求开一个 Promise，超时/出错就回退到
 * 主线程实现——worker 挂掉绝不能变成「会话打不开」。
 */
export interface HistoryParseRequest {
	readonly id: number;
	readonly sessionPath: string;
}

export type HistoryParseResponse =
	| { readonly id: number; readonly ok: true; readonly history: HistoryEntry[] }
	| { readonly id: number; readonly ok: false; readonly error: string };

const port = parentPort;
if (port) {
	port.on("message", (message: HistoryParseRequest) => {
		void (async () => {
			try {
				const text = await readFile(message.sessionPath, "utf8");
				const { history } = projectSessionFileText(message.sessionPath, text);
				port.postMessage({ id: message.id, ok: true, history } satisfies HistoryParseResponse);
			} catch (error) {
				const message_ = error instanceof Error ? error.message : String(error);
				port.postMessage({ id: message.id, ok: false, error: message_ } satisfies HistoryParseResponse);
			}
		})();
	});
}
