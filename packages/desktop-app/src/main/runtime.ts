import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AuthStorage, getAgentDir, ModelRegistry } from "@vetta/coding-agent";
import { RuntimeHost } from "../../../runtime-core/src/index.js";
import { getBuiltinSkillPaths } from "./builtin-skills.js";
import { readDesktopConfig } from "./config/desktop-config-store.js";
import { DEFAULT_SERVER_URL } from "./constants.js";
import { getDesktopUserQuestionBroker } from "./conversations/user-question-broker.js";
import { getAppLogger } from "./logger.js";
import { getDesktopModelCredentialStore } from "./models/model-credential-store.js";
import { readModelsConfigSync } from "./models/model-settings-service.js";
import { getAvailableLinuxBubblewrapPath, getAvailableMacosSandboxExecPath } from "./sandbox/capability.js";
import { resolveWindowsSandboxHostBinary } from "./sandbox/windows-binary-resolver.js";

// 进程级共享 RuntimeHost：session IPC、定时任务 (scheduler) 与批量任务
// (batch-tasks) 必须复用同一实例，否则任一模块 createSession 后没 dispose
// 时，其它模块再次 open 同一 sessionPath 会在同进程里撞 SessionLockError，
// 导致点击跳转走向 Welcome 页（见定时任务历史跳转 bug）。
let sharedRuntime: RuntimeHost | null = null;
let sharedModelRegistry: ModelRegistry | null = null;
const runtimeLog = getAppLogger("runtime");

/**
 * 直接从 settings.json 读 serverToken。
 *
 * 不复用 `ipc/settings.ts` 的 `readSettings()` 是为了避免 settings.ts ↔
 * runtime.ts 的循环 import（settings.ts 已经 import `peekSharedRuntime`）。
 * 内容只有 5 行，inline 比拉公共文件更省心。
 */
function readServerTokenFromDisk(): string | undefined {
	const path = join(getAgentDir(), "settings.json");
	if (!existsSync(path)) return undefined;
	try {
		const settings = JSON.parse(readFileSync(path, "utf-8")) as { serverToken?: string };
		return settings.serverToken;
	} catch {
		return undefined;
	}
}

/**
 * 进程级共享 ModelRegistry：所有 session 共用，避免每次 createSession 都重新
 * `fetch('/providers/models.json')`（线上实测一次 5 秒，是 Welcome 页发消息卡
 * 顿的主因）。
 *
 * 刷新策略（stale-while-revalidate）：
 *  - 启动时如果已登录，后台预热一次（非阻塞）；未登录则跳过，由登录回调触发。
 *  - 每次 createSession 完成后，RuntimeHost 顺手 fire-and-forget 一次刷新。
 *  - 登录/登出由 `ipc/settings.ts` 的 set-server-token handler 调
 *    `runtime.reloadServerAuth(token)`，命中本 registry 的同步刷新分支。
 *  - tokenGetter 每次从磁盘读 settings.json，保证多窗口/多进程也能拿到最新 token。
 */
export function getOrCreateSharedModelRegistry(): ModelRegistry {
	if (sharedModelRegistry) return sharedModelRegistry;
	const agentDir = getAgentDir();
	const authStorage = AuthStorage.create(join(agentDir, "auth.json"));
	const modelsPath = join(agentDir, "models.json");
	try {
		getDesktopModelCredentialStore().syncToAuthStorage(authStorage, readModelsConfigSync().providers);
	} catch (error) {
		runtimeLog.warn("加载模型加密凭据失败:", error);
	}
	const registry = new ModelRegistry(authStorage, modelsPath);
	registry.setServerUrl(DEFAULT_SERVER_URL);
	registry.setServerToken(readServerTokenFromDisk());
	registry.setServerTokenGetter(() => readServerTokenFromDisk());
	// 启动预热：未登录时 loadRemoteModels 内部早退（见 model-registry.ts），
	// 已登录则后台拉一次，期间 createSession 直接用 built-in + 上次磁盘缓存。
	void registry.loadRemoteModels();
	sharedModelRegistry = registry;
	return registry;
}

/** Return the shared RuntimeHost if one has been created, otherwise null. */
export function peekSharedRuntime(): RuntimeHost | null {
	return sharedRuntime;
}

export function getSharedRuntime(): RuntimeHost {
	if (!sharedRuntime) {
		sharedRuntime = new RuntimeHost({
			additionalSkillPaths: getBuiltinSkillPaths(),
			getDefaultExecutionMode: async () => {
				const config = await readDesktopConfig();
				return config.defaultExecutionMode;
			},
			sandboxHostPath: resolveWindowsSandboxHostBinary()?.path,
			linuxBubblewrapPath: getAvailableLinuxBubblewrapPath(),
			macosSandboxExecPath: getAvailableMacosSandboxExecPath(),
			// 把 desktop-app 编译期注入的 VETTA_SERVER_URL 显式喂给 SDK，
			// 防止 coding-agent 退回到自己 config.ts 里硬编码的 LAN 默认值，
			// 并把它静默写入 settings.json 污染 prod 用户的配置。
			serverUrl: DEFAULT_SERVER_URL,
			// 共享 ModelRegistry：去掉 createSession 的 5s 远程 fetch 阻塞。
			modelRegistry: getOrCreateSharedModelRegistry(),
			userQuestionHandler: getDesktopUserQuestionBroker().handle,
		});
	}
	return sharedRuntime;
}

export async function disposeSharedRuntime(): Promise<void> {
	if (!sharedRuntime) return;
	const runtime = sharedRuntime;
	sharedRuntime = null;
	await runtime.disposeAllSessions();
}
