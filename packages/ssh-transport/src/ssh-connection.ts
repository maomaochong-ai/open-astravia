import { parseRemoteDirectoryListing, type RemoteDirectoryEntry } from "./directory-listing.js";
import { SshOperationAbortedError, SshRemoteCommandError, SshTransportError } from "./errors.js";
import { SSH_TRANSPORT_FAILURE_EXIT_CODE, type SshProcessResult, type SshProcessRunner } from "./process-runner.js";
import {
	buildListDirectoryCommand,
	buildRemoteCommand,
	quoteShellArgument,
	type RemoteStatFlavor,
} from "./remote-command.js";
import { buildSshArgv } from "./ssh-argv.js";
import type { SshHost } from "./ssh-host.js";

export interface RemotePlatform {
	/** `uname -s`，例如 `Linux`、`Darwin`。 */
	readonly os: string;
	/** `uname -m`，例如 `x86_64`、`arm64`。 */
	readonly arch: string;
	readonly statFlavor: RemoteStatFlavor;
}

export interface SshExecOptions {
	readonly cwd?: string;
	readonly env?: Readonly<Record<string, string>>;
	readonly onStdout?: (chunk: Uint8Array) => void;
	readonly onStderr?: (chunk: Uint8Array) => void;
	readonly signal?: AbortSignal;
	readonly timeoutMs?: number;
}

export interface SshExecResult {
	readonly exitCode: number;
	readonly stdout: Uint8Array;
	readonly stderr: string;
}

export interface SshConnectionOptions {
	readonly runner: SshProcessRunner;
	readonly controlPath: string;
	/** 传给 ssh 子进程的额外环境变量，用于挂 askpass。 */
	readonly env?: Readonly<Record<string, string>>;
	readonly connectTimeoutSeconds?: number;
}

/**
 * 一台主机上的远端操作。
 *
 * 文件读写刻意**不**经过登录 shell：`$SHELL -l` 会 source `~/.profile`，而 profile
 * 里任何一句 echo 都会混进 stdout，把文件内容污染成「前面多了一行欢迎语」。只有用户
 * 命令（Agent 的 bash 工具）才需要登录 shell 带来的 PATH。
 *
 * 读写都走原始字节流而不是 base64：`ssh -T` 的 stdin/stdout 是 8-bit clean 的，
 * `cat` 本身不会往 stdout 写别的东西。绕开 base64 也就绕开了 GNU 的 `-d` 与 BSD 的
 * `-D` 不兼容这类远端差异。
 */
export class SshConnection {
	private platform: RemotePlatform | undefined;
	private homeDirectory: string | undefined;

	constructor(
		readonly host: SshHost,
		private readonly options: SshConnectionOptions,
	) {}

	/** 探测远端平台，结果缓存到连接对象上——同一台机器不会中途换系统。 */
	async probePlatform(signal?: AbortSignal): Promise<RemotePlatform> {
		if (this.platform) return this.platform;
		const result = await this.runChecked("uname -s && uname -m", { signal, timeoutMs: 20_000 });
		const [os = "", arch = ""] = decode(result.stdout).trim().split("\n");
		this.platform = {
			os: os.trim(),
			arch: arch.trim(),
			// BSD 家族（macOS、FreeBSD）的 stat 用 -f，其余按 GNU 处理。
			statFlavor: /darwin|bsd/i.test(os) ? "bsd" : "gnu",
		};
		return this.platform;
	}

	/**
	 * 远端家目录，结果缓存。
	 *
	 * 需要显式解析是因为所有路径都会被单引号引用，而 `'~'` 在 shell 里就是一个名叫
	 * `~` 的目录，不会展开。让调用方拿到真实路径再传进来，比在每个操作里偷偷展开
	 * 要好——后者会让「传进去的路径」和「实际操作的路径」对不上。
	 */
	async resolveHomeDirectory(signal?: AbortSignal): Promise<string> {
		if (this.homeDirectory !== undefined) return this.homeDirectory;
		// 模板串里写 `\${`：普通字符串里的 `${` 会被 lint 当成写漏的模板插值。
		const result = await this.runChecked(`printf %s "\${HOME:?no home}"`, { signal });
		this.homeDirectory = decode(result.stdout).trim();
		return this.homeDirectory;
	}

	/** 把开头的 `~` 展开成远端家目录；其余路径原样返回。 */
	async expandRemotePath(remotePath: string, signal?: AbortSignal): Promise<string> {
		if (remotePath !== "~" && !remotePath.startsWith("~/")) return remotePath;
		const home = await this.resolveHomeDirectory(signal);
		return remotePath === "~" ? home : `${home.replace(/\/+$/, "")}${remotePath.slice(1)}`;
	}

	/** 执行用户命令。走登录 shell，因此 nvm、pyenv 之类的 PATH 设置生效。 */
	async exec(command: string, options: SshExecOptions = {}): Promise<SshExecResult> {
		const result = await this.run(buildRemoteCommand(command, { cwd: options.cwd, env: options.env }), options);
		return { exitCode: result.exitCode ?? 0, stdout: result.stdout, stderr: result.stderr };
	}

	async readFile(remotePath: string, signal?: AbortSignal): Promise<Uint8Array> {
		const result = await this.runChecked(`cat -- ${quoteShellArgument(remotePath)}`, { signal });
		return result.stdout;
	}

	/**
	 * 原子写：先写同目录下的临时文件再 `mv`。
	 *
	 * 同目录是必须的——`mv` 只有在同一文件系统内才是原子的，写到 /tmp 再 mv 会退化成
	 * 「复制 + 删除」，中途失败会留下一个被截断的目标文件。
	 */
	async writeFile(remotePath: string, content: Uint8Array, signal?: AbortSignal): Promise<void> {
		const temporary = `${remotePath}.vetta-tmp-${Date.now().toString(36)}`;
		const quotedTemp = quoteShellArgument(temporary);
		const command = `cat > ${quotedTemp} && mv -f -- ${quotedTemp} ${quoteShellArgument(remotePath)}`;
		await this.runChecked(command, { signal, stdin: content });
	}

	async makeDirectory(remotePath: string, signal?: AbortSignal): Promise<void> {
		await this.runChecked(`mkdir -p -- ${quoteShellArgument(remotePath)}`, { signal });
	}

	async listDirectory(remotePath: string, signal?: AbortSignal): Promise<RemoteDirectoryEntry[]> {
		const platform = await this.probePlatform(signal);
		const result = await this.runChecked(buildListDirectoryCommand(remotePath, platform.statFlavor), { signal });
		return parseRemoteDirectoryListing(decode(result.stdout));
	}

	/** 路径不存在时返回 null——这是远端给出的正面答复，不是「问不到」。 */
	async stat(remotePath: string, signal?: AbortSignal): Promise<RemoteDirectoryEntry | null> {
		const platform = await this.probePlatform(signal);
		const format = platform.statFlavor === "gnu" ? `--printf='%F\\t%s\\t%Y\\t%n\\n'` : `-f '%HT\\t%z\\t%m\\t%N'`;
		const quoted = quoteShellArgument(remotePath);
		// `[ -e ]` 先判存在：不存在时直接退 0 并输出空，避免把 stat 的报错当成传输故障。
		const result = await this.runChecked(`[ -e ${quoted} ] && stat ${format} ${quoted} || true`, { signal });
		const entries = parseRemoteDirectoryListing(decode(result.stdout));
		const entry = entries[0];
		if (!entry) return null;
		// stat 回显的是传入路径，这里换回调用方期望的名字。
		return { ...entry, name: basename(remotePath) };
	}

	/** 退出码非零即抛。内部操作都用它——它们没有「失败也算正常」的分支。 */
	private async runChecked(
		remoteCommand: string,
		options: { signal?: AbortSignal; timeoutMs?: number; stdin?: Uint8Array },
	): Promise<SshProcessResult> {
		const result = await this.run(remoteCommand, options);
		if (result.exitCode !== 0) {
			throw new SshRemoteCommandError(
				`Remote command failed on ${this.host.label} (exit ${result.exitCode}): ${result.stderr.trim()}`,
				this.host.id,
				result.exitCode ?? -1,
				result.stderr,
			);
		}
		return result;
	}

	private async run(
		remoteCommand: string,
		options: {
			signal?: AbortSignal;
			timeoutMs?: number;
			stdin?: Uint8Array;
			onStdout?: (chunk: Uint8Array) => void;
			onStderr?: (chunk: Uint8Array) => void;
		},
	): Promise<SshProcessResult> {
		const argv = buildSshArgv(
			this.host,
			{ controlPath: this.options.controlPath, connectTimeoutSeconds: this.options.connectTimeoutSeconds },
			remoteCommand,
		);
		const result = await this.options.runner.run({
			argv,
			stdin: options.stdin,
			onStdout: options.onStdout,
			onStderr: options.onStderr,
			signal: options.signal,
			timeoutMs: options.timeoutMs,
			env: this.options.env,
		});
		if (result.aborted) {
			throw new SshOperationAbortedError(`Remote operation on ${this.host.label} was cancelled.`, this.host.id);
		}
		// 255 是 OpenSSH 表示连接层失败的保留码。远端命令本身也可能返回 255，两者无法
		// 完全区分；宁可报成「问不到」——把连接故障误判成「命令失败」会让上层以为拿到了
		// 远端的答复，而反过来只是多一次重试。
		if (result.exitCode === SSH_TRANSPORT_FAILURE_EXIT_CODE) {
			throw new SshTransportError(
				`Cannot reach ${this.host.label}: ${result.stderr.trim()}`,
				this.host.id,
				result.stderr,
			);
		}
		return result;
	}
}

function decode(bytes: Uint8Array): string {
	return new TextDecoder().decode(bytes);
}

function basename(remotePath: string): string {
	const trimmed = remotePath.replace(/\/+$/, "");
	const index = trimmed.lastIndexOf("/");
	return index < 0 ? trimmed : trimmed.slice(index + 1);
}
