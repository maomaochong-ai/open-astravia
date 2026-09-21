import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";

/**
 * OpenSSH 执行的那个 askpass 程序。
 *
 * 两个文件在运行时写出来，而不是随包分发：内容只有几十行且完全由本进程决定，
 * 运行时生成就不必在打包清单、asar 解包和代码签名三处各维护一遍路径。
 *
 * `SSH_ASKPASS` 必须是可执行文件，所以外层是一个 shell 脚本；真正的逻辑用 Electron
 * 自带的 Node 运行（`ELECTRON_RUN_AS_NODE=1`），这样不要求用户机器上装有 node。
 */

/** 转成 shell 双引号里安全的形式。路径可能含空格，用户名也可能含引号。 */
function quoteForShell(value: string): string {
	return `"${value.replace(/(["$`\\])/g, "\\$1")}"`;
}

const ASKPASS_ENTRY_SOURCE = `#!/usr/bin/env node
// 由 Vetta 运行时生成，手工修改会在下次启动时被覆盖。
//
// OpenSSH 把提示文本作为 argv[2] 传进来，期待答案打到 stdout。确认类提示（首次主机
// 指纹核对）不看 stdout，只看退出码：0 视为「是」，非 0 视为「否」。
const net = require("node:net");

const socketPath = process.env.VETTA_ASKPASS_SOCKET;
const token = process.env.VETTA_ASKPASS_TOKEN;
const prompt = process.argv[2] ?? "";
const hostId = process.env.VETTA_ASKPASS_HOST ?? "";
const promptEnv = process.env.SSH_ASKPASS_PROMPT ?? "";
// 父进程就是发起这次提示的那个 ssh——外层 shell 用的是 exec，没有多套一层。
// 上层靠它区分「同一轮认证的第二次追问」与「下一次连接」。
const round = process.ppid;

if (!socketPath || !token) {
	// 没有回传通道就必须失败。这里若静默放行，确认类提示会变成「默认同意」。
	process.stderr.write("vetta askpass: missing channel\\n");
	process.exit(1);
}

const socket = net.createConnection(socketPath);
let buffer = "";
let settled = false;

function finish(code, answer) {
	if (settled) return;
	settled = true;
	if (typeof answer === "string" && answer.length > 0) process.stdout.write(answer + "\\n");
	socket.destroy();
	process.exit(code);
}

socket.on("connect", () => {
	socket.write(JSON.stringify({ token, hostId, prompt, promptEnv, round }) + "\\n");
});
socket.on("data", (chunk) => {
	buffer += chunk.toString("utf8");
	const newline = buffer.indexOf("\\n");
	if (newline === -1) return;
	let reply;
	try {
		reply = JSON.parse(buffer.slice(0, newline));
	} catch {
		finish(1);
		return;
	}
	// 用户取消、拒绝确认或通道拒绝，一律以非零退出让 ssh 放弃本次认证。
	finish(reply && reply.ok ? 0 : 1, reply ? reply.value : undefined);
});
socket.on("error", () => finish(1));
socket.on("close", () => finish(1));
`;

export interface AskpassAssets {
	/** 交给 `SSH_ASKPASS` 的可执行脚本路径。 */
	readonly scriptPath: string;
}

/** 写出 askpass 的两个文件并返回脚本路径。每次启动覆盖，保证内容与当前版本一致。 */
export function ensureAskpassAssets(electronExecutablePath: string): AskpassAssets {
	const directory = join(getVettaHomePath(), "ssh");
	mkdirSync(directory, { recursive: true, mode: 0o700 });

	const entryPath = join(directory, "askpass-entry.cjs");
	writeFileSync(entryPath, ASKPASS_ENTRY_SOURCE, { mode: 0o600 });

	const scriptPath = join(directory, "askpass.sh");
	const script = [
		"#!/bin/sh",
		"# 由 Vetta 运行时生成。",
		`ELECTRON_RUN_AS_NODE=1 exec ${quoteForShell(electronExecutablePath)} ${quoteForShell(entryPath)} "$@"`,
		"",
	].join("\n");
	writeFileSync(scriptPath, script, { mode: 0o700 });
	// writeFileSync 的 mode 会被 umask 削减，显式补一次可执行位。
	chmodSync(scriptPath, 0o700);

	return { scriptPath };
}
