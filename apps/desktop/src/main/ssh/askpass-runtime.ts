import { buildAskpassEnvironment } from "@vetta/ssh-transport";
import { app } from "electron";
import { getDesktopCredentialVault } from "../credentials/desktop-credential-vault.js";
import { getAppLogger } from "../logger.js";
import { ensureAskpassAssets } from "./askpass-assets.js";
import { createSshAskpassChannel, type SshAskpassChannel } from "./askpass-server.js";
import { askSshPromptInRenderer } from "./ssh-prompt-broker.js";
import { SshPromptService } from "./ssh-prompt-service.js";

const log = getAppLogger("ssh-askpass");

let channel: SshAskpassChannel | undefined;
let promptService: SshPromptService | undefined;

function getPromptService(resolveHostLabel: (hostId: string) => string): SshPromptService {
	promptService ??= new SshPromptService({
		resolveHostLabel,
		readStoredSecret: (ref) => {
			const vault = getDesktopCredentialVault();
			// 安全存储不可用（例如 Linux 上只有明文后端）时当作没有存档，改为问用户。
			if (!vault.isAvailable() || !vault.has(ref)) return undefined;
			try {
				return vault.get(ref);
			} catch (error) {
				log.warn("failed to read stored ssh secret", error);
				return undefined;
			}
		},
		writeStoredSecret: (ref, value) => {
			try {
				getDesktopCredentialVault().put(ref, value, { kind: ref.name, consumer: "ssh" });
			} catch (error) {
				// 存不下不该让这次连接失败——用户已经把口令给我们了。
				log.warn("failed to store ssh secret", error);
			}
		},
		removeStoredSecret: (ref) => {
			try {
				getDesktopCredentialVault().remove(ref);
			} catch (error) {
				log.warn("failed to drop stale ssh secret", error);
			}
		},
		askUser: askSshPromptInRenderer,
	});
	return promptService;
}

/**
 * 为一次连接准备 askpass 环境变量。
 *
 * 没有这套东西时，需要口令、私钥密码、2FA 或首次主机指纹确认的连接会一直挂到超时，
 * 而且完全看不出原因——系统 `ssh` 的这些提示不读 stdin，只走 `SSH_ASKPASS`。
 */
export function resolveAskpassEnvironment(
	hostId: string,
	resolveHostLabel: (hostId: string) => string,
): Record<string, string> | undefined {
	try {
		const service = getPromptService(resolveHostLabel);
		channel ??= createSshAskpassChannel(service.resolve);
		const { scriptPath } = ensureAskpassAssets(app.getPath("exe"));
		return {
			...buildAskpassEnvironment(scriptPath, process.env.DISPLAY),
			VETTA_ASKPASS_SOCKET: channel.socketPath,
			VETTA_ASKPASS_TOKEN: channel.token,
			VETTA_ASKPASS_HOST: hostId,
		};
	} catch (error) {
		// 准备失败就退回「没有 askpass」的状态：免密主机照常能连，需要交互的会失败并
		// 带着 ssh 自己的报错，好过让整个连接入口崩掉。
		log.warn("failed to prepare ssh askpass", error);
		return undefined;
	}
}

/** 连接成功后调用：清掉「这轮已经用过存档凭据」的标记。 */
export function resetSshPromptState(hostId: string): void {
	promptService?.reset(hostId);
}

export function disposeAskpassChannel(): void {
	channel?.close();
	channel = undefined;
}
