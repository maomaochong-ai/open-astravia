import { randomBytes, timingSafeEqual } from "node:crypto";
import { rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifySshPrompt, type SshPromptKind } from "@vetta/ssh-transport";

export interface SshPromptAnswer {
	/** false 表示用户取消或拒绝确认；askpass 会以非零退出让 ssh 放弃本次认证。 */
	readonly ok: boolean;
	/** 确认类提示没有值。 */
	readonly value?: string;
}

export interface SshAskpassRequest {
	/** 发起本次连接的主机。凭据按主机存取，提示也要让用户看清是哪台机器。 */
	readonly hostId: string;
	readonly kind: SshPromptKind;
	readonly prompt: string;
}

export type SshPromptResolver = (request: SshAskpassRequest) => Promise<SshPromptAnswer>;

export interface SshAskpassChannel {
	readonly socketPath: string;
	readonly token: string;
	close(): void;
}

/**
 * 接收 askpass 程序回传的提示，交给上层去问用户。
 *
 * 用 Unix domain socket 而不是本地 TCP：socket 文件放在只有本用户可进的目录里，
 * 天然不对外暴露；TCP 端口同机任何进程都能连。token 是第二道闸——socket 路径可能
 * 出现在进程列表或日志里，光靠路径保密不够。
 */
export function createSshAskpassChannel(resolve: SshPromptResolver): SshAskpassChannel {
	const token = randomBytes(32).toString("hex");
	// 路径要短：Unix socket 的 sun_path 在 macOS 上只有 104 字节。
	const socketPath = join(tmpdir(), `vetta-askpass-${randomBytes(8).toString("hex")}.sock`);
	rmSync(socketPath, { force: true });

	const server: Server = createServer((socket) => handleConnection(socket, token, resolve));
	server.listen(socketPath);
	// 监听失败（目录不可写等）不该让整个应用崩掉；此时远程连接会因为拿不到口令而失败，
	// 错误会带着 ssh 自己的信息浮出来。
	server.on("error", () => {});

	return {
		socketPath,
		token,
		close: () => {
			server.close();
			rmSync(socketPath, { force: true });
		},
	};
}

function handleConnection(socket: Socket, token: string, resolve: SshPromptResolver): void {
	let buffer = "";
	let handled = false;
	socket.setEncoding("utf8");
	socket.on("error", () => socket.destroy());
	socket.on("data", (chunk: string) => {
		if (handled) return;
		buffer += chunk;
		const newline = buffer.indexOf("\n");
		if (newline === -1) {
			// 单条请求不可能这么大；超长说明对端不是我们的 askpass。
			if (buffer.length > 64 * 1024) socket.destroy();
			return;
		}
		handled = true;
		void answer(socket, buffer.slice(0, newline), token, resolve);
	});
}

async function answer(socket: Socket, line: string, token: string, resolve: SshPromptResolver): Promise<void> {
	const reply = (value: SshPromptAnswer): void => {
		socket.end(`${JSON.stringify(value)}\n`);
	};
	let request: { token?: unknown; hostId?: unknown; prompt?: unknown; promptEnv?: unknown };
	try {
		request = JSON.parse(line) as typeof request;
	} catch {
		reply({ ok: false });
		return;
	}
	if (typeof request.token !== "string" || !matchesToken(request.token, token)) {
		reply({ ok: false });
		return;
	}
	const prompt = typeof request.prompt === "string" ? request.prompt : "";
	const promptEnv = typeof request.promptEnv === "string" ? request.promptEnv : undefined;
	const hostId = typeof request.hostId === "string" ? request.hostId : "";
	try {
		reply(await resolve({ hostId, kind: classifySshPrompt(prompt, promptEnv), prompt }));
	} catch {
		// 上层出错时按「拒绝」处理：确认类提示绝不能因为一次异常就变成默认同意。
		reply({ ok: false });
	}
}

function matchesToken(candidate: string, expected: string): boolean {
	const left = Buffer.from(candidate);
	const right = Buffer.from(expected);
	return left.length === right.length && timingSafeEqual(left, right);
}
