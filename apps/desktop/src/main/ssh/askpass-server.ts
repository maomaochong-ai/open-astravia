import { randomBytes, timingSafeEqual } from "node:crypto";
import { rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifySshPrompt, type SshPromptKind } from "@astravia/ssh-transport";

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
	/**
	 * 发起这次提示的 `ssh` 进程号，用来判断两次提示是不是同一轮认证。
	 *
	 * OpenSSH 不给轮次标识，但 askpass 是被 `ssh` 直接 exec 出来的，父进程号就是那个
	 * `ssh`。密码错了它会在同一个进程里连问三次，换一轮则必然是另一个进程。
	 * 拿不到时为 undefined，此时所有提示会退化成共用一轮。
	 */
	readonly round?: number;
}

export type SshPromptResolver = (request: SshAskpassRequest) => Promise<SshPromptAnswer>;

export interface SshAskpassChannel {
	/**
	 * askpass 程序回连主进程的地址：非 Windows 是 unix socket 文件路径，Windows 是
	 * `127.0.0.1:<port>`。都经 `ASTRAVIA_ASKPASS_SOCKET` 环境变量传给 askpass 程序。
	 */
	readonly socketPath: string;
	readonly token: string;
	close(): void;
}

/**
 * 接收 askpass 程序回传的提示，交给上层去问用户。
 *
 * 非 Windows 用 Unix domain socket：socket 文件放在只有本用户可进的目录里，天然不对外
 * 暴露。Windows 没有 unix socket，改在 loopback 上监听随机端口；安全仍靠 32 字节随机
 * token 维持——同机进程能连得进端口，但拿不到 token 就无法通过校验。
 */
export async function createSshAskpassChannel(
	resolve: SshPromptResolver,
	platform: NodeJS.Platform = process.platform,
): Promise<SshAskpassChannel> {
	const token = randomBytes(32).toString("hex");
	const isWindows = platform === "win32";
	// 路径要短：Unix socket 的 sun_path 在 macOS 上只有 104 字节。
	const socketPath = isWindows ? "" : join(tmpdir(), `astravia-askpass-${randomBytes(8).toString("hex")}.sock`);
	if (!isWindows) rmSync(socketPath, { force: true });

	const server: Server = createServer((socket) => handleConnection(socket, token, resolve));
	if (isWindows) {
		// TCP 端口由系统异步分配，必须等 listening 事件后 server.address() 才有值。
		// error 也要 reject：listen 失败时若没有 error listener，Node 会抛未捕获异常，
		// 而 listening 回调不触发会让这里永久挂起。失败上抛，由 resolveAskpassEnvironment
		// 的 catch 转成「不注入 askpass」，密码认证明确失败而不是卡死。
		await new Promise<void>((resolveListening, rejectListening) => {
			server.once("error", rejectListening);
			server.listen(0, "127.0.0.1", () => {
				server.removeListener("error", rejectListening);
				resolveListening();
			});
		});
	} else {
		server.listen(socketPath);
	}
	// 监听失败（目录不可写、端口被占等）不该让整个应用崩掉；此时远程连接会因为拿不到口令而失败，
	// 错误会带着 ssh 自己的信息浮出来。
	server.on("error", () => {});

	const address = (() => {
		if (!isWindows) return socketPath;
		const bound = server.address();
		if (bound && typeof bound === "object") return `127.0.0.1:${bound.port}`;
		// 拿不到端口意味着监听没成功，返回空串让 askpass 因「缺通道」快速失败。
		return "";
	})();

	return {
		socketPath: address,
		token,
		close: () => {
			server.close();
			if (!isWindows) rmSync(socketPath, { force: true });
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
	let request: { token?: unknown; hostId?: unknown; prompt?: unknown; promptEnv?: unknown; round?: unknown };
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
	const round =
		typeof request.round === "number" && Number.isInteger(request.round) && request.round > 0
			? request.round
			: undefined;
	try {
		reply(
			await resolve({
				hostId,
				kind: classifySshPrompt(prompt, promptEnv),
				prompt,
				...(round === undefined ? {} : { round }),
			}),
		);
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
