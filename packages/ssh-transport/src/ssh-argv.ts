import { createHash } from "node:crypto";
import type { SshHost } from "./ssh-host.js";

/**
 * 每台主机一条复用连接的保持时长。
 *
 * 取 10 分钟而不是无限：无限意味着用户在设置里改了主机配置、或者换了网络之后，
 * 旧 master 仍然活着并继续服务，改动要等到手工断开才生效。
 */
export const CONTROL_PERSIST_SECONDS = 600;

export interface SshArgvOptions {
	/** ControlMaster 的 socket 路径。 */
	readonly controlPath: string;
	/** 建连超时（秒）。只影响建立阶段，不影响已建立连接上的长命令。 */
	readonly connectTimeoutSeconds?: number;
	/** 是否分配 pty。批量取文件、跑非交互命令时必须为 false，否则输出会被 tty 改写。 */
	readonly requestTty?: boolean;
}

/**
 * 构造 `ssh` 的参数表。
 *
 * 一律走 argv 而不是拼 shell 命令，因此主机名、端口、私钥路径里的空格和引号都不需要
 * 转义，也不存在注入面；唯一需要防的是以 `-` 开头的值被当成选项，这在主机模型入口
 * 已经挡掉。
 *
 * 刻意**不**设置 `StrictHostKeyChecking`：保持 OpenSSH 默认的 `ask`。首次连接和主机
 * 密钥变更都必须由用户确认——设成 `no` 会让中间人攻击静默通过，这是 ADR-0120 明确
 * 禁止的；设成 `accept-new` 则跳过了首次确认。
 */
export function buildSshArgv(host: SshHost, options: SshArgvOptions, remoteCommand?: string): string[] {
	const argv: string[] = [
		// 复用同一条连接：认证只在建立 master 时发生一次，之后每次操作只是开一个 channel，
		// 否则每读一个文件都要重新握手加认证，一次几百毫秒。
		"-o",
		"ControlMaster=auto",
		"-o",
		`ControlPath=${options.controlPath}`,
		"-o",
		`ControlPersist=${CONTROL_PERSIST_SECONDS}`,
		"-o",
		`ConnectTimeout=${options.connectTimeoutSeconds ?? 15}`,
	];
	if (host.port !== undefined) argv.push("-p", String(host.port));
	if (host.identityFile) argv.push("-i", host.identityFile);
	argv.push(options.requestTty ? "-tt" : "-T");
	// `--` 之后 OpenSSH 不再解析选项，目标和远端命令都按字面量处理。
	argv.push("--", host.target);
	if (remoteCommand !== undefined) argv.push(remoteCommand);
	return argv;
}

/**
 * ControlPath 必须短。
 *
 * 它是一个 Unix domain socket 路径，`sockaddr_un.sun_path` 在 macOS 上只有 104 字节、
 * Linux 上 108 字节。直接用 `<tmp>/vetta-ssh-<hostId>-<user>@<host>:<port>` 这类可读名字，
 * 在稍长的用户名或临时目录下就会超长，表现为连接偶发失败且错误信息完全看不出原因。
 * 所以用短哈希，并且把目录也算进长度检查。
 */
export function buildControlPath(baseDirectory: string, hostId: string): string {
	const digest = createHash("sha256").update(hostId).digest("hex").slice(0, 16);
	const path = `${baseDirectory.replace(/\/+$/, "")}/${digest}`;
	if (path.length > 100) {
		throw new Error(`SSH control socket path is too long (${path.length} bytes): ${path}`);
	}
	return path;
}
