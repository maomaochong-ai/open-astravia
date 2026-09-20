import type { RemoteDirectoryEntry, SshConnectionStatus, SshHost } from "@vetta/ssh-transport";
import type { SshHostStatusEvent } from "../../shared/ssh-ipc.js";

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
	onHostsChanged(listener: () => void): () => void;
	onHostStatusChanged(listener: (event: SshHostStatusEvent) => void): () => void;
}
