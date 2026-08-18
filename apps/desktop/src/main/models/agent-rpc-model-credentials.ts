/**
 * 把桌面保险库里的自定义 provider API Key 注入 agent-rpc 子进程的 AuthStorage。
 *
 * 背景：`ModelSettingsService` 落盘时会把明文 key 从 `models.json` 移到
 * safeStorage 保险库，只在 provider 上留 `credentialRef`。主进程对话页靠
 * `DesktopModelCredentialStore.syncToAuthStorage()` 在进程内补回凭据，但
 * Claw（im-gateway → `Vetta --agent-rpc`）是**另一个进程**，它经 `@vetta/cli-host`
 * 自建 bootstrap，只读 `models.json` / `auth.json`，不认识 `credentialRef`。
 * 缺凭据时 coding-agent 的 ModelRuntime 会回落到本地 provider 的 "no auth"
 * 占位串并把它当 Bearer 发出去，远端 provider（deepseek 等）随即报 401。
 *
 * 子进程同样是 Electron，且 `app.name` 与主进程一致（见 shared/app-identity.ts），
 * 保险库又存在共享的 `~/.vetta/desktop-app/credentials`（不是 userData），
 * 所以子进程可以自己解密——明文 key 不需要经过 argv 或环境变量外传。
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import type { CodingAgentAuthRuntime } from "@vetta/coding-agent/host-services";

/** 只取注入需要的字段；models.json 的完整 schema 由 coding-agent 校验。 */
export interface CredentialRefProviders {
	[providerId: string]: { credentialRef?: string };
}

export interface AgentRpcModelCredentialSource {
	syncToAuthStorage(authStorage: CodingAgentAuthRuntime, providers: CredentialRefProviders): void;
}

export interface SyncAgentRpcModelCredentialsOptions {
	readonly authStorage: CodingAgentAuthRuntime;
	readonly credentials: AgentRpcModelCredentialSource;
	readonly modelsJsonPath?: string;
	readonly readModelsJson?: (path: string) => Promise<string>;
	readonly onError?: (error: unknown) => void;
}

/** 默认 models.json 位置；与 ModelSettingsService 的落盘路径保持一致。 */
export function defaultModelsJsonPath(): string {
	return join(getVettaHomePath(), "agent", "models.json");
}

/**
 * 解析 models.json 中带 `credentialRef` 的 provider，并把保险库里的 key 注入
 * AuthStorage。models.json 缺失、损坏或保险库不可用都按"无凭据"处理：让后续
 * 模型调用报自己的鉴权错误，而不是在启动阶段炸掉整个子进程。
 */
export async function syncAgentRpcModelCredentials(options: SyncAgentRpcModelCredentialsOptions): Promise<void> {
	const path = options.modelsJsonPath ?? defaultModelsJsonPath();
	const read = options.readModelsJson ?? ((target: string) => readFile(target, "utf8"));
	try {
		const parsed: unknown = JSON.parse(await read(path));
		const providers = extractCredentialRefProviders(parsed);
		if (Object.keys(providers).length === 0) return;
		options.credentials.syncToAuthStorage(options.authStorage, providers);
	} catch (error) {
		options.onError?.(error);
	}
}

export function extractCredentialRefProviders(parsed: unknown): CredentialRefProviders {
	if (!parsed || typeof parsed !== "object") return {};
	const providers = (parsed as { providers?: unknown }).providers;
	if (!providers || typeof providers !== "object") return {};
	const result: CredentialRefProviders = {};
	for (const [providerId, provider] of Object.entries(providers as Record<string, unknown>)) {
		if (!provider || typeof provider !== "object") continue;
		const credentialRef = (provider as { credentialRef?: unknown }).credentialRef;
		if (typeof credentialRef !== "string" || credentialRef.length === 0) continue;
		result[providerId] = { credentialRef };
	}
	return result;
}
