import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import {
	buildControlPath,
	createNodeSshProcessRunner,
	type SshConnection,
	SshConnectionManager,
	type SshConnectionStatus,
} from "@vetta/ssh-transport";
import { readConfigSync } from "../config/desktop-config-store.js";
import { getAppLogger } from "../logger.js";
import { resolveAskpassEnvironment } from "./askpass-runtime.js";
import { resolveSshHelperBinary } from "./helper-assets.js";
import { broadcastSshHostStatus } from "./ssh-events.js";

const log = getAppLogger("ssh");

let manager: SshConnectionManager | undefined;

/**
 * ControlMaster socket 的存放目录。
 *
 * 这是个 Unix domain socket 路径，`sun_path` 在 macOS 上只有 104 字节。优先放在
 * Vetta 主目录下（通常很短），但用户的家目录可能很长——例如域账号或中文用户名——
 * 那时退回 `/tmp`。两者都超长时 buildControlPath 会抛，让失败在连接前就暴露出来，
 * 而不是变成一次原因完全看不出的连接超时。
 */
function resolveControlDirectory(): string {
	const candidates = [join(getVettaHomePath(), "ssh"), join(tmpdir(), "vetta-ssh")];
	for (const candidate of candidates) {
		try {
			mkdirSync(candidate, { recursive: true, mode: 0o700 });
			// 先用一个样例 id 验长度，避免建完目录才发现每次连接都超长。
			buildControlPath(candidate, "probe");
			return candidate;
		} catch {
			// 建不出来或路径太长，试下一个候选。
		}
	}
	throw new Error("Unable to create a short-enough SSH control socket directory.");
}

/**
 * 进程内唯一的 SSH 连接管理器。
 *
 * 单例是必须的：ControlMaster 的复用以 socket 路径为准，而路径由 hostId 推导。
 * 多个管理器实例会各自缓存平台探测结果和连接状态，UI 显示的状态就会和实际执行
 * 用的那条连接对不上。
 */
export function getSshConnectionManager(): SshConnectionManager {
	manager ??= new SshConnectionManager({
		runner: createNodeSshProcessRunner(),
		controlDirectory: resolveControlDirectory(),
		// 同步读配置：连接可能在任意一次工具调用中途建立，异步读会让这里变成一个
		// 需要在每个调用点 await 的入口。
		resolveHost: (hostId) => readConfigSync().sshHosts?.find((host) => host.id === hostId),
		// 口令、私钥密码、2FA 和首次主机指纹确认都靠它接到界面上；缺了这套环境变量，
		// 这些连接只会挂到超时。
		resolveEnv: (hostId) =>
			resolveAskpassEnvironment(
				hostId,
				(id) => readConfigSync().sshHosts?.find((host) => host.id === id)?.label ?? id,
			),
		helper: {
			resolveBinary: resolveSshHelperBinary,
			// helper 起不来不影响使用，但要能查：否则「后台任务断线就没了」无从解释。
			onDiagnostic: (message) => log.info(message),
		},
		onTrace: ({ command, output }) => {
			// 远端有输出却一条都解析不出：多半是远端的 stat 输出格式与预期不符。
			// 界面只会显示「没有子目录」，不记下来就无从查起。
			log.warn("remote directory listing parsed to nothing", { command, output });
		},
		onStatusChanged: broadcastSshHostStatus,
	});
	return manager;
}

export function getSshConnection(hostId: string): SshConnection {
	return getSshConnectionManager().connection(hostId);
}

export function getSshHostStatus(hostId: string): SshConnectionStatus {
	return getSshConnectionManager().getStatus(hostId);
}
