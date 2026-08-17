import { join } from "node:path";
import { app } from "electron";

// ---------------------------------------------------------------------------
// Coding-agent RPC CLI mode
// ---------------------------------------------------------------------------
// When the parent process spawns Vetta.app with `--agent-rpc` (followed by
// the coding-agent CLI args), main.ts short-circuits into this command:
// we forward everything after `--agent-rpc` to `@vetta/cli-app`'s runtime
// host. The host owns one production Runtime; scenario flags only select
// Coding Agent capabilities such as the IM host bridge.
//
// Production-only motivation: a packaged Vetta.app does not ship a
// standalone `vetta` CLI on PATH, so im-gateway cannot spawn coding-agent
// as a subprocess by name. Reusing Vetta.app's own executable avoids
// shipping a second binary.

const AGENT_RPC_FLAG = "--agent-rpc";

/**
 * Returns the arg list to forward to coding-agent, or null when the
 * discriminator flag is absent. Stripping the flag itself keeps
 * coding-agent's argument parser happy.
 */
export function parseAgentRpcCommand(argv: string[]): string[] | null {
	const idx = argv.indexOf(AGENT_RPC_FLAG);
	if (idx === -1) return null;
	// Everything after the flag is coding-agent's argv. The args before it
	// are Electron's own bootstrapping (executable path, main entry in dev)
	// which we deliberately drop.
	return argv.slice(idx + 1);
}

/**
 * Resolve the directory coding-agent should treat as its package root for
 * looking up bundled on-disk assets (themes, export-html template, banner,
 * package.json). The agent's `getPackageDir()` walks up from `__dirname`
 * looking for a `package.json`, which inside an Electron asar bundle lands
 * on the host app's package.json — wrong tree, missing assets. We override
 * via `VETTA_PACKAGE_DIR` (the env var coding-agent's config.ts already
 * honours) so theme + export-html lookups succeed.
 *
 * Layout matched by prepare-pack.js / extraResources:
 *   Production:  <Resources>/coding-agent/{package.json,dist/...}
 *   Dev:         <workspace>/packages/coding-agent/
 */
function resolveCodingAgentPackageDir(): string {
	if (app.isPackaged) {
		return join(process.resourcesPath, "coding-agent");
	}
	const appRoot = app.getAppPath();
	return join(appRoot, "..", "coding-agent");
}

/**
 * 组装凭据注入回调：models.json 只留 `credentialRef`，明文 key 在 safeStorage
 * 保险库里，只有这个 Electron 子进程能解密（见 models/agent-rpc-model-credentials.ts）。
 *
 * 全程动态 import：`model-credential-store` / `logger` 在模块顶层就建 logger 实例，
 * 静态导入会把它们提到 logger 模块自身初始化之前求值，主进程加载直接挂在
 * "Cannot access 'appLoggingConfigured' before initialization"。Rollup 关于
 * 「既动态又静态导入」的提示无害。
 *
 * 装配失败（保险库不可用、日志子系统异常等）只降级为「不注入」：宁可让后续模型调用
 * 报自己的鉴权错误，也不能让整个 Claw 子进程起不来——本地无鉴权 provider 本来能用。
 */
async function loadRuntimeCredentialInjector(): Promise<
	NonNullable<Parameters<typeof import("@vetta/cli-app").runAgentRuntimeCli>[1]>["injectRuntimeCredentials"]
> {
	try {
		const [{ syncAgentRpcModelCredentials }, { getDesktopModelCredentialStore }, { getAppLogger }] =
			await Promise.all([
				import("../models/agent-rpc-model-credentials.js"),
				import("../models/model-credential-store.js"),
				import("../logger.js"),
			]);
		return (authStorage) =>
			syncAgentRpcModelCredentials({
				authStorage,
				credentials: getDesktopModelCredentialStore(),
				onError: (error) => {
					getAppLogger("agent-rpc-credentials").warn("无法注入自定义 provider 凭据，模型调用可能鉴权失败", {
						error: error instanceof Error ? error.message : String(error),
					});
				},
			});
	} catch (error) {
		// logger 本身可能就是失败的那一环，只能直接写 stderr。
		const reason = error instanceof Error ? error.message : String(error);
		process.stderr.write(`[agent-rpc] 凭据注入不可用，自定义 provider 可能鉴权失败: ${reason}\n`);
		return undefined;
	}
}

export async function runAgentRpcCommand(args: string[]): Promise<number> {
	try {
		if (!process.env.VETTA_PACKAGE_DIR && !process.env.PI_PACKAGE_DIR) {
			process.env.VETTA_PACKAGE_DIR = resolveCodingAgentPackageDir();
		}
		const { runAgentRuntimeCli } = await import("@vetta/cli-app");
		const injectRuntimeCredentials = await loadRuntimeCredentialInjector();
		await runAgentRuntimeCli(args, { injectRuntimeCredentials });
		return typeof process.exitCode === "number" ? process.exitCode : 0;
	} catch (err) {
		const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
		process.stderr.write(`${msg}\n`);
		return 1;
	}
}
