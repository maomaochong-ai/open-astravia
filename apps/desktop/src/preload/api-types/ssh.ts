import type { RemoteDirectoryEntry, RemoteListenerScan, SshConnectionStatus, SshHost } from "@vetta/ssh-transport";
import type { PortForward } from "../../main/ssh/port-forward-service.js";
import type { SshHostStatusEvent } from "../../shared/ssh-ipc.js";
import type { SshPromptRequestEvent, SshPromptResponse } from "../../shared/ssh-prompt-ipc.js";

// ─── 远程项目宿主（SSH） ───
//
// 对应 `src/main/ipc/ssh.ts`。注意与 `remote-pairing` 不是一回事：那个是「手机遥控
// 本机」，这个是「本机连到远端主机上开发」，方向相反。

export interface SshHostSummary extends SshHost {
	/** 运行期连接状态，不落配置文件。 */
	status: SshConnectionStatus;
}

export interface SshHostFormInput {
	label: string;
	/** `~/.ssh/config` 的别名，或 `user@host`。 */
	target: string;
	port?: number;
	identityFile?: string;
}

export interface SshHostProbe {
	ok: boolean;
	os: string;
	arch: string;
	shell: string;
	homeDirectory: string;
	hasGit: boolean;
	hasRipgrep: boolean;
	/** 失败原因，成功时为空串。 */
	error: string;
}

export interface SshRemoteListing {
	/** 实际列举的绝对路径（`~` 已展开成远端家目录）。 */
	remotePath: string;
	entries: RemoteDirectoryEntry[];
}

export interface SshPortForwardRequest {
	hostId: string;
	remotePort: number;
	/** 省略时优先用与远端同号的本机端口，被占用再换号。 */
	localPort?: number;
	label?: string;
	/** `detected` 表示这一条来自自动发现的候选，用户只是点了确认。 */
	source?: "manual" | "detected";
}

export interface DesktopSshApi {
	listHosts(): Promise<SshHostSummary[]>;
	createHost(input: SshHostFormInput): Promise<SshHost>;
	updateHost(input: SshHostFormInput & { id: string }): Promise<SshHost>;
	/** 仍有项目指向该主机时会失败——那些项目会变成永远打不开的悬空条目。 */
	removeHost(hostId: string): Promise<void>;
	/** 读取 `~/.ssh/config` 中可直接连接的别名（不含通配条目）。 */
	listConfigAliases(): Promise<string[]>;
	/** 按别名导入，只新增不覆盖已有条目。返回本次新增的主机。 */
	importFromConfig(aliases: readonly string[]): Promise<SshHost[]>;
	/** 「测试连接」：一次往返取回系统、shell 与 git/rg 是否可用。 */
	testHost(hostId: string): Promise<SshHostProbe>;
	getHostStatus(hostId: string): Promise<SshConnectionStatus>;
	/** 远端目录浏览器。`remotePath` 省略时从远端家目录开始。 */
	listRemoteDirectory(input: { hostId: string; remotePath?: string }): Promise<SshRemoteListing>;
	/**
	 * 远端正在监听、且可以转发回本机的 TCP 端口。
	 *
	 * 结果带上实际用了哪种手段：`tool` 为 `none` 是「远端没有可用的扫描工具」，与「没有端口
	 * 在听」不是一回事，界面要据此改成让用户手动输入端口号。
	 */
	listListeningPorts(hostId: string): Promise<RemoteListenerScan>;
	/** 已建立的端口转发。省略 hostId 时给出全部主机的。 */
	listPortForwards(hostId?: string): Promise<PortForward[]>;
	/**
	 * 建立一条转发，返回它最终用上的本机端口——请求的那个可能已被占用。
	 * 远端 sshd 关掉了转发（`AllowTcpForwarding no`）时失败，原因照原样带出来。
	 */
	openPortForward(request: SshPortForwardRequest): Promise<PortForward>;
	closePortForward(input: { hostId: string; remotePort: number }): Promise<void>;
	onPortForwardsChanged(listener: () => void): () => void;
	onHostsChanged(listener: () => void): () => void;
	onHostStatusChanged(listener: (event: SshHostStatusEvent) => void): () => void;
	/**
	 * OpenSSH 要用户回答一次提示：远端口令、私钥密码、一次性验证码，或首次主机指纹确认。
	 * 由全局浮层接管——提示可能由后台的一次工具调用触发，那时用户并不在设置页。
	 */
	onPromptRequest(listener: (event: SshPromptRequestEvent) => void): () => void;
	/** 提示已失效（连接取消或超时），关掉界面即可。 */
	onPromptCancelled(listener: (id: string) => void): () => void;
	respondToPrompt(response: SshPromptResponse): void;
}
