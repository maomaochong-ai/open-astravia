import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
	HELPER_PROTOCOL_VERSION,
	isCompatibleHelperVersion,
	SshHelperClient,
	type SshHelperHello,
} from "./helper-client.js";
import { quoteShellArgument } from "./remote-command.js";
import type { RemotePlatform, SshConnection } from "./ssh-connection.js";

export interface SshHelperTarget {
	readonly os: "linux" | "darwin";
	readonly arch: "amd64" | "arm64";
}

/** 给出某个远端平台对应的 helper 二进制在**本机**的路径；没有这个平台的构建时返回 undefined。 */
export type SshHelperBinaryResolver = (target: SshHelperTarget) => string | undefined;

export interface ConnectSshHelperOptions {
	readonly resolveBinary: SshHelperBinaryResolver;
	/** 每一步降级的原因。helper 是可选加速，失败不该打断用户，但得留下可查的痕迹。 */
	readonly onDiagnostic?: (message: string) => void;
	readonly handshakeTimeoutMs?: number;
}

const HANDSHAKE_TIMEOUT_MS = 15_000;

export function resolveSshHelperTarget(platform: RemotePlatform): SshHelperTarget | undefined {
	const os = /^linux$/i.test(platform.os) ? "linux" : /^darwin$/i.test(platform.os) ? "darwin" : undefined;
	const arch = /^(x86_64|amd64)$/i.test(platform.arch)
		? "amd64"
		: /^(aarch64|arm64)$/i.test(platform.arch)
			? "arm64"
			: undefined;
	return os && arch ? { os, arch } : undefined;
}

/**
 * 把 helper 送到远端并连上它；任何一步不成就返回 undefined，调用方走 `ssh exec` 的降级路径。
 *
 * 安装目录按**协议版本**命名，不按构建哈希（ADR-0124）。内容用 sha256 比对：同一协议版本
 * 下二进制被替换（修了个 bug）时会重新上传，而目录名不变，旧 helper 起的任务依然看得见——
 * 任务状态存在与版本无关的目录里。
 */
export async function connectSshHelper(
	connection: SshConnection,
	options: ConnectSshHelperOptions,
): Promise<SshHelperClient | undefined> {
	const note = (message: string): void => options.onDiagnostic?.(`[ssh-helper] ${connection.host.label}: ${message}`);
	try {
		const target = resolveSshHelperTarget(await connection.probePlatform());
		if (!target) {
			note("unsupported remote platform; using ssh exec");
			return undefined;
		}
		const localPath = options.resolveBinary(target);
		if (!localPath) {
			note(`no helper build for ${target.os}-${target.arch}; using ssh exec`);
			return undefined;
		}
		const binary = await readFile(localPath);
		const digest = createHash("sha256").update(binary).digest("hex");
		const home = await connection.resolveHomeDirectory();
		const directory = `${home.replace(/\/+$/, "")}/.cache/vetta/helper/${HELPER_PROTOCOL_VERSION}`;
		const remotePath = `${directory}/vetta-ssh-helper`;

		if ((await remoteDigest(connection, remotePath)) !== digest) {
			await connection.makeDirectory(directory);
			await connection.writeFile(remotePath, binary);
			await connection.exec(`chmod 700 ${quoteShellArgument(remotePath)}`);
			// 上传后再验一次：半截文件跑起来的报错与「这台机器不支持」无法区分。
			if ((await remoteDigest(connection, remotePath)) !== digest) {
				note("uploaded helper failed its checksum; using ssh exec");
				return undefined;
			}
			note(`installed helper ${HELPER_PROTOCOL_VERSION} (${target.os}-${target.arch})`);
		}

		const client = SshHelperClient.attach((feed) => {
			const channel = connection.openChannel(`${quoteShellArgument(remotePath)} serve`, feed);
			if (!channel) throw new Error("this SSH runner cannot hold a channel open");
			return channel;
		});
		const hello = await withTimeout(
			client.call<SshHelperHello>("hello"),
			options.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS,
		);
		if (!isCompatibleHelperVersion(hello.protocolVersion)) {
			note(`helper speaks protocol ${hello.protocolVersion}, expected ${HELPER_PROTOCOL_VERSION}; using ssh exec`);
			client.close();
			return undefined;
		}
		return client;
	} catch (error) {
		note(`unavailable (${error instanceof Error ? error.message : String(error)}); using ssh exec`);
		return undefined;
	}
}

async function remoteDigest(connection: SshConnection, remotePath: string): Promise<string | undefined> {
	const quoted = quoteShellArgument(remotePath);
	const chunks: Uint8Array[] = [];
	// Linux 有 sha256sum，macOS 只有 shasum；都没有就当作「需要上传」。
	const result = await connection.exec(
		`sha256sum -- ${quoted} 2>/dev/null || shasum -a 256 -- ${quoted} 2>/dev/null`,
		{
			onStdout: (chunk) => chunks.push(chunk),
		},
	);
	if (result.exitCode !== 0) return undefined;
	// 登录 shell 的 profile 可能往 stdout 打横幅，所以按形状找摘要，不假定它在第一行。
	return /\b[0-9a-f]{64}\b/.exec(Buffer.concat(chunks).toString("utf8"))?.[0];
}

function withTimeout<Value>(promise: Promise<Value>, timeoutMs: number): Promise<Value> {
	return new Promise<Value>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`no handshake within ${timeoutMs}ms`)), timeoutMs);
		timer.unref?.();
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error: unknown) => {
				clearTimeout(timer);
				reject(error instanceof Error ? error : new Error(String(error)));
			},
		);
	});
}
