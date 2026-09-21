import { randomBytes } from "node:crypto";
import { parseRemoteDirectoryListing, type RemoteDirectoryEntry } from "./directory-listing.js";
import { SshOperationAbortedError, SshRemoteCommandError, SshTransportError } from "./errors.js";
import { type SshHelperClient, SshHelperClosedError, SshHelperError } from "./helper-client.js";
import { type ConnectSshHelperOptions, connectSshHelper } from "./helper-deployment.js";
import {
	SSH_TRANSPORT_FAILURE_EXIT_CODE,
	type SshProcessChannel,
	type SshProcessResult,
	type SshProcessRunner,
} from "./process-runner.js";
import { normalizeRemotePath } from "./project-uri.js";
import {
	buildCreateEntryCommand,
	buildKillCommand,
	buildListDirectoryCommand,
	buildListFilesRecursiveCommand,
	buildRealPathCommand,
	buildRemoteCommand,
	buildStatCommand,
	buildWriteFileCommand,
	type ListFilesRecursiveOptions,
	quoteShellArgument,
	REMOTE_ENTRY_EXISTS_EXIT_CODE,
	type RemoteStatFlavor,
} from "./remote-command.js";
import {
	buildListListeningPortsCommand,
	parseRemoteListeners,
	type RemoteListenerScan,
	type RemoteListeningPort,
	selectForwardablePorts,
} from "./remote-listeners.js";
import {
	buildTtyShellCommand,
	isRemotePtyDataNotification,
	isRemotePtyExitNotification,
	type OpenRemotePtyOptions,
	type RemotePtySession,
} from "./remote-pty.js";
import { buildPortForwardArgv, buildSshArgv } from "./ssh-argv.js";
import type { SshHost } from "./ssh-host.js";

/**
 * 一台主机上第一条命令的超时。
 *
 * 它同时是建立连接的那一条，所以要把用户输入口令、私钥密码或 2FA 验证码的时间算进去。
 * 按「几秒就该连上」设的话，弹窗还在等用户打字，ssh 就被我们自己杀掉了，表现为输完
 * 密码却提示连接失败。
 *
 * 主机不可达由 OpenSSH 自己的 `ConnectTimeout` 兜底（见 buildSshArgv），不依赖这里。
 */
const FIRST_COMMAND_TIMEOUT_MS = 4 * 60 * 1000;

/** 终止远端进程组的那条命令自己的超时：TERM 后最多等 2 秒再 KILL，留足余量。 */
const REMOTE_KILL_TIMEOUT_MS = 15_000;

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
	/**
	 * 诊断钩子。
	 *
	 * 目录列举这类操作会出现「命令退出 0、输出也有内容，但解析完是空的」——界面只能
	 * 显示「没有子目录」，从现象完全反推不到原因（实际遇到过：远端是中文 locale，
	 * stat 输出「目录」而不是 directory）。把原始命令与输出留给宿主记日志，这类故障
	 * 才有可能被查出来。
	 */
	/**
	 * 给出时，连接会按需把远端 helper 送过去并连上（见 {@link SshConnection.helper}）。
	 * 不给就始终走 `ssh exec`。
	 */
	readonly helper?: ConnectSshHelperOptions;
	readonly onTrace?: (event: {
		readonly command: string;
		readonly output: string;
		readonly entryCount: number;
	}) => void;
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
	private helperClient: Promise<SshHelperClient | undefined> | undefined;
	/** 已经握手成功、可以直接用的 helper。部署过程中为空，那时文件操作走 `ssh exec`。 */
	private readyHelper: SshHelperClient | undefined;

	constructor(
		readonly host: SshHost,
		private readonly options: SshConnectionOptions,
	) {}

	/** 探测远端平台，结果缓存到连接对象上——同一台机器不会中途换系统。 */
	async probePlatform(signal?: AbortSignal): Promise<RemotePlatform> {
		if (this.platform) return this.platform;
		const result = await this.runChecked("uname -s && uname -m", { signal, timeoutMs: FIRST_COMMAND_TIMEOUT_MS });
		const [os = "", arch = ""] = decode(result.stdout).trim().split("\n");
		this.platform = {
			os: os.trim(),
			arch: arch.trim(),
			// BSD 家族（macOS、FreeBSD）的 stat 用 -f，其余按 GNU 处理。
			statFlavor: /darwin|bsd/i.test(os) ? "bsd" : "gnu",
		};
		// 连接一通就在后台把 helper 备好：就绪之后文件操作不必再为每一次读写新起一个 ssh 进程。
		if (this.options.helper) void this.helper().catch(() => {});
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
		// 先确保连接已建立。认证（口令、2FA、指纹确认）只发生在第一条命令上，而调用方
		// 给的 timeout 是按「这条命令该跑多久」定的——几十秒——会在用户还在输密码时
		// 把 ssh 杀掉。探测结果有缓存，之后的调用不会多一次往返。
		await this.probePlatform(options.signal);
		const processToken = `vetta-exec-${randomBytes(8).toString("hex")}`;
		// 取消与超时都收到这里统一处理，因为两者要做同一件事：**立刻**去远端把进程组杀掉。
		// 没有 pty，掐掉本地 ssh 并不会让远端进程结束；而等本地 ssh 自己退出再去杀也不行——
		// 远端进程还攥着通道的 stdout，本地 ssh 可能就一直等在那里。
		const controller = new AbortController();
		let interruption: "aborted" | "timeout" | undefined;
		let remoteKill: Promise<unknown> | undefined;
		const interrupt = (reason: "aborted" | "timeout"): void => {
			if (interruption) return;
			interruption = reason;
			remoteKill = this.run(buildKillCommand(processToken), { timeoutMs: REMOTE_KILL_TIMEOUT_MS }).catch(() => {});
			controller.abort();
		};
		const onAbort = (): void => interrupt("aborted");
		if (options.signal?.aborted) interrupt("aborted");
		options.signal?.addEventListener("abort", onAbort, { once: true });
		const timer =
			options.timeoutMs === undefined ? undefined : setTimeout(() => interrupt("timeout"), options.timeoutMs);
		timer?.unref?.();

		let result: SshProcessResult;
		try {
			result = await this.run(buildRemoteCommand(command, { cwd: options.cwd, env: options.env, processToken }), {
				onStdout: options.onStdout,
				onStderr: options.onStderr,
				signal: controller.signal,
			});
		} catch (error) {
			if (interruption) {
				await remoteKill;
				throw new SshOperationAbortedError(
					interruption === "timeout"
						? `Remote operation on ${this.host.label} timed out.`
						: `Remote operation on ${this.host.label} was cancelled.`,
					this.host.id,
					interruption,
				);
			}
			// 传输故障时也尝试清理：可能只是这一条通道断了。杀不到就算了，错误照原样抛。
			if (error instanceof SshTransportError) {
				await this.run(buildKillCommand(processToken), { timeoutMs: REMOTE_KILL_TIMEOUT_MS }).catch(() => {});
			}
			throw error;
		} finally {
			if (timer !== undefined) clearTimeout(timer);
			options.signal?.removeEventListener("abort", onAbort);
		}
		if (result.exitCode === null) {
			// 本地 ssh 被外部信号杀掉：远端命令的结局不可知，不能报成 0。
			throw new SshTransportError(
				`Lost the connection to ${this.host.label} while the command was running.`,
				this.host.id,
				result.stderr,
			);
		}
		return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
	}

	async readFile(remotePath: string, signal?: AbortSignal): Promise<Uint8Array> {
		const viaHelper = await this.viaHelper((helper) =>
			helper.call<{ data: string }>("fs.readFile", { path: remotePath, offset: 0, length: -1 }),
		);
		if (viaHelper) return Buffer.from(viaHelper.value.data, "base64");
		const result = await this.runChecked(`cat -- ${quoteShellArgument(remotePath)}`, { signal });
		return result.stdout;
	}

	/** 只取文件开头若干字节，用于判断类型：不必为了看一眼文件头把整份文件拖过网络。 */
	async readFileHead(remotePath: string, byteCount: number, signal?: AbortSignal): Promise<Uint8Array> {
		const viaHelper = await this.viaHelper((helper) =>
			helper.call<{ data: string }>("fs.readFile", {
				path: remotePath,
				offset: 0,
				length: Math.max(0, Math.floor(byteCount)),
			}),
		);
		if (viaHelper) return Buffer.from(viaHelper.value.data, "base64");
		const count = Math.max(0, Math.floor(byteCount));
		const result = await this.runChecked(`head -c ${count} -- ${quoteShellArgument(remotePath)}`, { signal });
		return result.stdout;
	}

	/**
	 * 读取 `[start, start + length)` 这一段字节。媒体播放按 Range 取数据，拖动进度条时不必
	 * 把整份文件拖过网络。`tail -c +N` 从第 N 个字节起（从 1 计数），GNU 与 BSD 同义。
	 */
	async readFileRange(remotePath: string, start: number, length: number, signal?: AbortSignal): Promise<Uint8Array> {
		const viaHelper = await this.viaHelper((helper) =>
			helper.call<{ data: string }>("fs.readFile", {
				path: remotePath,
				offset: Math.max(0, Math.floor(start)),
				length: Math.max(0, Math.floor(length)),
			}),
		);
		if (viaHelper) return Buffer.from(viaHelper.value.data, "base64");
		const from = Math.max(0, Math.floor(start)) + 1;
		const count = Math.max(0, Math.floor(length));
		const quoted = quoteShellArgument(remotePath);
		const result = await this.runChecked(`tail -c +${from} -- ${quoted} | head -c ${count}`, { signal });
		return result.stdout;
	}

	/** 原子写，保留原文件的权限位并穿透符号链接，见 {@link buildWriteFileCommand}。 */
	async writeFile(remotePath: string, content: Uint8Array, signal?: AbortSignal): Promise<void> {
		const viaHelper = await this.viaHelper((helper) =>
			helper.call("fs.writeFile", { path: remotePath, data: Buffer.from(content).toString("base64") }),
		);
		if (viaHelper) return;
		const command = buildWriteFileCommand(remotePath, `.vetta-tmp-${Date.now().toString(36)}`);
		await this.runChecked(command, { signal, stdin: content });
	}

	/** 同一文件系统内是原子改名；跨文件系统时 `mv` 自己退化成复制加删除。目标已存在则覆盖。 */
	async rename(fromPath: string, toPath: string, signal?: AbortSignal): Promise<void> {
		if (await this.viaHelper((helper) => helper.call("fs.rename", { from: fromPath, to: toPath }))) return;
		await this.runChecked(`mv -f -- ${quoteShellArgument(fromPath)} ${quoteShellArgument(toPath)}`, { signal });
	}

	/** 递归删除。路径不存在也算成功——与本机 `rm(force)` 同义。 */
	async remove(remotePath: string, signal?: AbortSignal): Promise<void> {
		if (normalizeRemotePath(remotePath) === "/") throw new Error("Refusing to remove the remote root directory.");
		if (await this.viaHelper((helper) => helper.call("fs.remove", { path: remotePath }))) return;
		await this.runChecked(`rm -rf -- ${quoteShellArgument(remotePath)}`, { signal });
	}

	/** 新建空文件或目录；已存在时返回 `"exists"` 而不是覆盖。 */
	async createEntry(
		remotePath: string,
		kind: "file" | "directory",
		signal?: AbortSignal,
	): Promise<"created" | "exists"> {
		const viaHelper = await this.viaHelper(async (helper) => {
			try {
				await helper.call("fs.createEntry", { path: remotePath, kind });
				return "created" as const;
			} catch (error) {
				if (error instanceof SshHelperError && error.code === "EEXIST") return "exists" as const;
				throw error;
			}
		});
		if (viaHelper) return viaHelper.value;
		const result = await this.run(buildCreateEntryCommand(remotePath, kind), { signal });
		if (result.exitCode === 0) return "created";
		if (result.exitCode === REMOTE_ENTRY_EXISTS_EXIT_CODE) return "exists";
		throw new SshRemoteCommandError(
			`Remote command failed on ${this.host.label} (exit ${result.exitCode}): ${result.stderr.trim()}`,
			this.host.id,
			result.exitCode ?? -1,
			result.stderr,
		);
	}

	/** 递归列出普通文件的相对路径（POSIX 分隔，无 `./` 前缀）。 */
	async listFilesRecursive(
		remotePath: string,
		options: ListFilesRecursiveOptions,
		signal?: AbortSignal,
	): Promise<string[]> {
		const viaHelper = await this.viaHelper((helper) =>
			helper.call<{ files: string[] }>("fs.listRecursive", {
				path: remotePath,
				ignoredDirectories: options.ignoredDirectoryNames,
				limit: options.limit,
			}),
		);
		if (viaHelper) return viaHelper.value.files;
		const result = await this.runChecked(buildListFilesRecursiveCommand(remotePath, options), { signal });
		return decode(result.stdout)
			.split("\n")
			.map((line) => line.replace(/^\.\//, ""))
			.filter((line) => line.length > 0);
	}

	async makeDirectory(remotePath: string, signal?: AbortSignal): Promise<void> {
		if (await this.viaHelper((helper) => helper.call("fs.mkdir", { path: remotePath }))) return;
		await this.runChecked(`mkdir -p -- ${quoteShellArgument(remotePath)}`, { signal });
	}

	async listDirectory(remotePath: string, signal?: AbortSignal): Promise<RemoteDirectoryEntry[]> {
		const viaHelper = await this.viaHelper((helper) =>
			helper.call<{ entries: HelperEntry[] }>("fs.readDir", { path: remotePath }),
		);
		if (viaHelper) return viaHelper.value.entries.map(fromHelperEntry);
		const platform = await this.probePlatform(signal);
		const command = buildListDirectoryCommand(remotePath, platform.statFlavor);
		const result = await this.runChecked(command, { signal });
		const output = decode(result.stdout);
		const entries = parseRemoteDirectoryListing(output);
		// 只在「有输出却解析不出条目」时上报：那是解析与远端输出格式对不上的信号，
		// 也是唯一一种不会报错、却让界面显示为空的故障。
		if (entries.length === 0 && output.trim().length > 0) {
			this.options.onTrace?.({ command, output: output.slice(0, 2_000), entryCount: 0 });
		}
		return entries;
	}

	/** 路径不存在时返回 null——这是远端给出的正面答复，不是「问不到」。 */
	async stat(
		remotePath: string,
		signal?: AbortSignal,
		options: { readonly followSymlinks?: boolean } = {},
	): Promise<RemoteDirectoryEntry | null> {
		const viaHelper = await this.viaHelper((helper) =>
			helper.call<{ entry: HelperEntry | null }>("fs.stat", {
				path: remotePath,
				followSymlinks: options.followSymlinks === true,
			}),
		);
		if (viaHelper) return viaHelper.value.entry ? fromHelperEntry(viaHelper.value.entry) : null;
		const platform = await this.probePlatform(signal);
		const result = await this.runChecked(buildStatCommand(remotePath, platform.statFlavor, options), { signal });
		const entries = parseRemoteDirectoryListing(decode(result.stdout));
		const entry = entries[0];
		if (!entry) return null;
		// stat 回显的是传入路径，这里换回调用方期望的名字。
		return { ...entry, name: basename(remotePath) };
	}

	/** 真实路径。路径不存在，或远端的 readlink 不支持 `-f` 时，原样返回传入的路径。 */
	async realPath(remotePath: string, signal?: AbortSignal): Promise<string> {
		const viaHelper = await this.viaHelper(async (helper) => {
			try {
				return (await helper.call<{ path: string }>("fs.realPath", { path: remotePath })).path;
			} catch (error) {
				// 与 exec 那条路同义：路径不存在时原样返回。
				if (error instanceof SshHelperError && error.code === "ENOENT") return remotePath;
				throw error;
			}
		});
		if (viaHelper) return viaHelper.value;
		const result = await this.run(buildRealPathCommand(remotePath), { signal });
		const resolved = decode(result.stdout).trim();
		return result.exitCode === 0 && resolved.startsWith("/") ? resolved : remotePath;
	}

	/**
	 * 远端 helper；不可用时为 undefined，调用方必须有 `ssh exec` 的降级路径。
	 *
	 * 同一条连接上只建立一次。helper 的通道断了（网络抖动、远端被杀）之后下一次调用会重连，
	 * 而「这台主机用不了 helper」的结论同样被记住，不会每个操作都重新上传一遍试试。
	 */
	helper(): Promise<SshHelperClient | undefined> {
		const options = this.options.helper;
		if (!options) return Promise.resolve(undefined);
		if (!this.helperClient) {
			const attempt = connectSshHelper(this, options).then((client) => {
				this.readyHelper = client;
				client?.onClose(() => {
					if (this.readyHelper === client) this.readyHelper = undefined;
					if (this.helperClient === attempt) this.helperClient = undefined;
				});
				return client;
			});
			this.helperClient = attempt;
		}
		return this.helperClient;
	}

	/**
	 * 把远端的一个端口转发到本机端口上。
	 *
	 * 远程项目里的预览服务器（设计画布的 vite）必须跑在项目所在的机器上才读得到项目文件，
	 * 而界面只能连本机的端口——转发是把这两件事接起来的唯一办法。
	 *
	 * 服务端可能关掉了转发（`AllowTcpForwarding no`，精简镜像与加固过的堡垒机上很常见）。
	 * 那种情况下 `-O forward` 会失败，这里如实抛出：否则界面会连上一个转发不过去的本机端口，
	 * 表现为莫名其妙的 connection reset。
	 */
	async forwardPort(localPort: number, remotePort: number, signal?: AbortSignal): Promise<void> {
		// 先确保 master 在：`-O forward` 只对已建立的控制连接有效。
		await this.probePlatform(signal);
		const result = await this.options.runner.run({
			argv: buildPortForwardArgv(this.host, { controlPath: this.options.controlPath }, { localPort, remotePort }),
			signal,
			env: this.options.env,
		});
		if (result.exitCode !== 0) {
			const detail = result.stderr.trim();
			throw new SshTransportError(
				`Cannot forward port ${remotePort} from ${this.host.label}` +
					`${detail ? `: ${detail}` : "."} The SSH server may have TCP forwarding disabled (AllowTcpForwarding).`,
				this.host.id,
				result.stderr,
			);
		}
	}

	/** 撤掉一条转发。失败不抛：转发会随 master 一起消失，清理不掉不该拖累调用方收尾。 */
	async cancelPortForward(localPort: number, remotePort: number): Promise<void> {
		await this.options.runner
			.run({
				argv: buildPortForwardArgv(
					this.host,
					{ controlPath: this.options.controlPath },
					{ localPort, remotePort, cancel: true },
				),
				env: this.options.env,
			})
			.catch(() => undefined);
	}

	/**
	 * 远端正在监听的、可以转发回本机的 TCP 端口。
	 *
	 * 用户要转发的是「我刚起的那个开发服务器」，但他记不住端口，也不该为了查它去开一个
	 * 终端。这里直接问远端，界面就能把候选摆出来。
	 *
	 * 返回值带上实际用了哪种手段：「远端一个扫描工具都没装」是远端给出的明确答复，不是
	 * 传输故障，界面要据此改成让用户手动输入端口号，所以不能用抛错表达。
	 *
	 * 结果按端口去重并滤掉转不过去的地址；这条连接自己用的 sshd 端口也不列——它总在，
	 * 且转发它没有意义。
	 */
	async listListeningPorts(signal?: AbortSignal): Promise<RemoteListenerScan> {
		const excludePorts = [22, ...(this.host.port === undefined ? [] : [this.host.port])];
		const viaHelper = await this.viaHelper(async (helper) => {
			try {
				return (await helper.call<{ ports: RemoteListeningPort[] }>("net.listeners")).ports;
			} catch (error) {
				// 远端可能还留着不认识这个方法的旧 helper，或者 helper 在这个系统上没实现它。
				// 那不是远端的否定答复，退回 `ssh exec` 扫一遍才是对的。
				if (error instanceof SshHelperError && error.code === "ENOSYS") return undefined;
				throw error;
			}
		});
		if (viaHelper?.value) {
			return { tool: "helper", ports: selectForwardablePorts(viaHelper.value, { excludePorts }) };
		}
		const platform = await this.probePlatform(signal);
		const result = await this.runChecked(buildListListeningPortsCommand(platform.statFlavor), { signal });
		const scan = parseRemoteListeners(decode(result.stdout));
		return { tool: scan.tool, ports: selectForwardablePorts(scan.ports, { excludePorts }) };
	}

	/**
	 * 打开一条保持连接的通道，远端命令的 stdin/stdout 交给调用方。执行器不支持时返回
	 * undefined，调用方据此走一问一答的降级路径。
	 */
	openChannel(
		remoteCommand: string,
		onStdout: (chunk: Uint8Array) => void,
		options: { readonly requestTty?: boolean } = {},
	): SshProcessChannel | undefined {
		if (!this.options.runner.open) return undefined;
		const argv = buildSshArgv(
			this.host,
			{
				controlPath: this.options.controlPath,
				connectTimeoutSeconds: this.options.connectTimeoutSeconds,
				requestTty: options.requestTty,
			},
			remoteCommand,
		);
		return this.options.runner.open({ argv, onStdout, env: this.options.env });
	}

	/**
	 * 开一个远端交互式终端。
	 *
	 * helper 在就用 `pty.*`：真伪终端、能改尺寸、输出走通知推送。helper 不在或版本旧
	 * （`ENOSYS`）就退回 `ssh -tt`——能用，但送不进窗口尺寸变化，所以会把
	 * `canResize: false` 报给上层，由界面如实告知用户。
	 *
	 * 与 `proc.*` 刻意不同：终端是连接作用域的，通道断了这个会话就结束，不做落盘接管。
	 */
	async openPty(options: OpenRemotePtyOptions): Promise<RemotePtySession> {
		const viaHelper = await this.viaHelper(async (helper) => {
			try {
				const opened = await helper.call<{ id: string }>("pty.open", {
					cwd: options.cwd,
					shell: options.shell,
					env: options.env,
					cols: Math.trunc(options.cols),
					rows: Math.trunc(options.rows),
				});
				return this.helperPtySession(helper, opened.id);
			} catch (error) {
				// 旧 helper 不认识 pty.*：这不是远端的否定答复，退回 `ssh -tt` 才对。
				if (error instanceof SshHelperError && error.code === "ENOSYS") return undefined;
				throw error;
			}
		});
		if (viaHelper?.value) return viaHelper.value;
		return this.ttyPtySession(options);
	}

	private helperPtySession(helper: SshHelperClient, ptyId: string): RemotePtySession {
		const dataListeners = new Set<(chunk: string, dropped: number) => void>();
		const exit = createExitLatch();
		const offData = helper.on("pty.data", (params) => {
			if (!isRemotePtyDataNotification(params) || params.id !== ptyId) return;
			const chunk = decode(Uint8Array.from(Buffer.from(params.dataB64, "base64")));
			const dropped = typeof params.dropped === "number" ? params.dropped : 0;
			for (const listener of dataListeners) listener(chunk, dropped);
		});
		const offExit = helper.on("pty.exit", (params) => {
			if (!isRemotePtyExitNotification(params) || params.id !== ptyId) return;
			exit.emit({ exitCode: typeof params.exitCode === "number" ? params.exitCode : null });
		});
		const detach = (): void => {
			offData();
			offExit();
		};
		return {
			backend: "helper",
			canResize: true,
			write: (data) => {
				void helper
					.call("pty.write", { id: ptyId, dataB64: Buffer.from(data, "utf8").toString("base64") })
					.catch(() => {});
			},
			resize: (cols, rows) => {
				void helper
					.call("pty.resize", { id: ptyId, cols: Math.trunc(cols), rows: Math.trunc(rows) })
					.catch(() => {});
			},
			close: () => {
				detach();
				void helper.call("pty.close", { id: ptyId }).catch(() => {});
			},
			onData: (listener) => {
				dataListeners.add(listener);
				return () => dataListeners.delete(listener);
			},
			onExit: exit.subscribe,
		};
	}

	private ttyPtySession(options: OpenRemotePtyOptions): RemotePtySession {
		const dataListeners = new Set<(chunk: string, dropped: number) => void>();
		const exit = createExitLatch();
		const channel = this.openChannel(
			buildTtyShellCommand(options),
			(chunk) => {
				const text = decode(chunk);
				// `ssh -tt` 这条路没有远端缓冲，不会丢块。
				for (const listener of dataListeners) listener(text, 0);
			},
			{ requestTty: true },
		);
		if (!channel) {
			throw new SshRemoteCommandError(
				`This runner cannot open an interactive terminal on ${this.host.label}`,
				this.host.id,
				-1,
				"",
			);
		}
		void channel.exited.then(({ exitCode }) => exit.emit({ exitCode }));
		return {
			backend: "tty",
			// 本机 stdin 不是 tty，窗口尺寸变化没有渠道送过去，也没法补发 SIGWINCH。
			canResize: false,
			write: (data) => channel.write(new TextEncoder().encode(data)),
			resize: () => {},
			close: () => channel.kill(),
			onData: (listener) => {
				dataListeners.add(listener);
				return () => dataListeners.delete(listener);
			},
			onExit: exit.subscribe,
		};
	}

	/**
	 * helper 就绪时经它完成一次操作；返回 undefined 表示「这次没走成，请用 `ssh exec`」。
	 *
	 * 两种失败要分开：helper **明确回答了不行**（文件不存在、没权限）是远端的答复，换一条路
	 * 再问一遍只会得到同样的结果，直接按远端命令失败上报；而**通道断了**说明没问到，这时
	 * 退回 `ssh exec` 才有意义。
	 */
	private async viaHelper<Value>(
		operation: (helper: SshHelperClient) => Promise<Value>,
	): Promise<{ readonly value: Value } | undefined> {
		const helper = this.readyHelper;
		if (!helper || helper.isClosed) return undefined;
		try {
			return { value: await operation(helper) };
		} catch (error) {
			if (error instanceof SshHelperClosedError) return undefined;
			if (error instanceof SshHelperError) {
				throw new SshRemoteCommandError(
					`Remote operation failed on ${this.host.label} (${error.code}): ${error.message}`,
					this.host.id,
					1,
					error.message,
				);
			}
			throw error;
		}
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
			throw new SshOperationAbortedError(
				result.timedOut
					? `Remote operation on ${this.host.label} timed out.`
					: `Remote operation on ${this.host.label} was cancelled.`,
				this.host.id,
				result.timedOut ? "timeout" : "aborted",
			);
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

interface HelperEntry {
	readonly name: string;
	readonly kind: RemoteDirectoryEntry["kind"];
	readonly size: number;
	readonly modifiedMs: number;
}

function fromHelperEntry(entry: HelperEntry): RemoteDirectoryEntry {
	return {
		name: entry.name,
		kind: entry.kind,
		sizeBytes: entry.size,
		modifiedAtSeconds: Math.floor(entry.modifiedMs / 1000),
	};
}

/**
 * 退出事件的锁存转发器。
 *
 * 会话可能在调用方注册 `onExit` 之前就结束了（shell 起不来、helper 立刻回 exit），
 * 那时直接广播等于把事件丢掉，界面会永远停在「启动中」。这里记住已发生的退出，
 * 后注册的监听者立刻补到。
 */
function createExitLatch(): {
	emit: (event: { exitCode: number | null }) => void;
	subscribe: (listener: (event: { exitCode: number | null }) => void) => () => void;
} {
	const listeners = new Set<(event: { exitCode: number | null }) => void>();
	let settled: { exitCode: number | null } | undefined;
	return {
		emit: (event) => {
			if (settled) return;
			settled = event;
			for (const listener of [...listeners]) listener(event);
			listeners.clear();
		},
		subscribe: (listener) => {
			if (settled) {
				listener(settled);
				return () => {};
			}
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}

function decode(bytes: Uint8Array): string {
	return new TextDecoder().decode(bytes);
}

function basename(remotePath: string): string {
	const trimmed = remotePath.replace(/\/+$/, "");
	const index = trimmed.lastIndexOf("/");
	return index < 0 ? trimmed : trimmed.slice(index + 1);
}
