import type { RuntimeHostPathServices, RuntimeQueueSidecarStore, RuntimeSandboxGrantStore } from "@vetta/runtime-core";
import { nodeRuntimeHostPathServices, nodeRuntimeQueueSidecarStore } from "@vetta/runtime-node/host";
import { nodeSandboxGrantStore } from "@vetta/runtime-node/sandbox";
import { isSshProjectUri } from "@vetta/ssh-transport";

/**
 * 在本机建目录之前先挡掉远程项目的 cwd。
 *
 * RuntimeHost 每次发 prompt 前都会「修复工作目录」，而它拿到的是会话登记时的原始 cwd——
 * 远程项目下那是一整串 `ssh://<hostId>/<远端路径>`。`fs.mkdir` 会把它规范化成相对路径
 * `ssh:/<hostId>/…`，于是在进程当前目录下建出一棵空目录树（开发态就落在 `apps/desktop/` 里）。
 * 失败还会被上层 catch 掉，所以它一声不响。
 *
 * 判定放在这一层而不是 runtime-core：那一层按设计不认识「远程项目」这回事，也不允许依赖
 * ssh-transport。远端目录在项目登记时已经校验过存在，这里直接跳过即可。
 */
const desktopRuntimeHostPathServices: RuntimeHostPathServices = {
	...nodeRuntimeHostPathServices,
	ensureDirectory: async (path) => {
		if (isSshProjectUri(path)) return;
		await nodeRuntimeHostPathServices.ensureDirectory(path);
	},
};

export interface DesktopRuntimeHostPlatformServices {
	readonly pathServices: RuntimeHostPathServices;
	readonly queueSidecarStore: RuntimeQueueSidecarStore;
	readonly sandboxGrantStore: RuntimeSandboxGrantStore;
}

/** Desktop's explicit Node host capability bundle for RuntimeHost composition. */
export function createDesktopRuntimeHostPlatformServices(): DesktopRuntimeHostPlatformServices {
	return {
		pathServices: desktopRuntimeHostPathServices,
		queueSidecarStore: nodeRuntimeQueueSidecarStore,
		sandboxGrantStore: nodeSandboxGrantStore,
	};
}
