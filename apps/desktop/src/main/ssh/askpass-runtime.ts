import { buildAskpassEnvironment } from "@astravia/ssh-transport";
import { app } from "electron";
import { getDesktopCredentialVault } from "../credentials/desktop-credential-vault.js";
import { getAppLogger } from "../logger.js";
import { ensureAskpassAssets } from "./askpass-assets.js";
import { resolveAskpassWindowsBinary } from "./askpass-binary.js";
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
				const value = vault.get(ref);
				// 只记「有没有存档、长度多少」，不记内容：口令进了日志就等于泄漏。
				log.info("ssh prompt answered from vault", {
					hostId: ref.ownerId,
					kind: ref.name,
					length: value?.length ?? 0,
				});
				return value;
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
		askUser: (request) => {
			// 「口令是被存档悄悄填进去的，还是真的问过用户」是排查登录失败的第一分叉：
			// 存档里的旧口令会让重试永远送同一个错值。
			log.info("ssh prompt asking user", {
				hostId: request.hostId,
				kind: request.kind,
				rememberable: request.rememberable,
			});
			return askSshPromptInRenderer(request);
		},
	});
	return promptService;
}

/** 当前平台的 askpass 程序路径；解析不到返回 undefined。 */
function resolveAskpassProgram(): string | undefined {
	if (process.platform === "win32") {
		return resolveAskpassWindowsBinary();
	}
	return ensureAskpassAssets(app.getPath("exe")).scriptPath;
}

/**
 * 为一次连接准备 askpass 环境变量。
 *
 * 没有这套东西时，需要口令、私钥密码、2FA 或首次主机指纹确认的连接会一直挂到超时，
 * 而且完全看不出原因——系统 `ssh` 的这些提示不读 stdin，只走 `SSH_ASKPASS`。
 */
export async function resolveAskpassEnvironment(
	hostId: string,
	resolveHostLabel: (hostId: string) => string,
): Promise<Record<string, string> | undefined> {
	try {
		const service = getPromptService(resolveHostLabel);
		channel ??= await createSshAskpassChannel(service.resolve);
		// Windows 的 OpenSSH 用 CreateProcessW 启动 SSH_ASKPASS，必须是 PE 可执行文件，
		// 所以走 Go 编译的 askpass.exe；其余平台沿用运行时生成的 `.sh` + Electron Node。
		const askpass = resolveAskpassProgram();
		if (!askpass) return undefined;
		return {
			...buildAskpassEnvironment(askpass, process.env.DISPLAY),
			ASTRAVIA_ASKPASS_SOCKET: channel.socketPath,
			ASTRAVIA_ASKPASS_TOKEN: channel.token,
			ASTRAVIA_ASKPASS_HOST: hostId,
		};
	} catch (error) {
		// 准备失败就退回「没有 askpass」的状态：免密主机照常能连，需要交互的会失败并
		// 带着 ssh 自己的报错，好过让整个连接入口崩掉。
		log.warn("failed to prepare ssh askpass", error);
		return undefined;
	}
}

export function disposeAskpassChannel(): void {
	channel?.close();
	channel = undefined;
}
