import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { actionPolicyPath, agentBrowserConfigPath, browserProfileDir, pluginDataDir, wrapperRuntimePath } from "./paths.mjs";
import { materializeAgentBrowserConfig, normalizeSnapshot } from "./materialize.mjs";

/**
 * 每次调用都根据 renderer 写下的策略快照重新物化 agent-browser 配置。
 *
 * 为什么每次都重写而不是让 renderer 直接写终态：只有本进程能正确解析插件数据目录
 * （见 paths.mjs），而配置里的 `profile` / `actionPolicy` 必须是绝对路径。
 *
 * 每次调用都重读快照还带来一个直接的好处：用户在设置页改完开关，下一条命令就生效，
 * 不需要新建会话。
 */

function readSnapshot(path) {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		// 首次启用时快照还不存在，用默认策略跑起来即可——保守默认（禁 eval / 禁上传）
		// 本身就是安全的那一侧。
		return {};
	}
}

/** @returns {{ configPath: string; snapshot: object }} */
export function prepareAgentBrowserConfig(env = process.env) {
	const snapshot = normalizeSnapshot(readSnapshot(wrapperRuntimePath(env)));
	const configPath = agentBrowserConfigPath(env);
	const policyPath = actionPolicyPath(env);
	const { config, actionPolicy } = materializeAgentBrowserConfig({
		snapshot,
		profileDir: browserProfileDir(env),
		actionPolicyPath: policyPath,
	});

	mkdirSync(pluginDataDir(env), { recursive: true });
	writeFileSync(configPath, `${JSON.stringify(config, null, "\t")}\n`, "utf8");
	writeFileSync(policyPath, `${JSON.stringify(actionPolicy, null, "\t")}\n`, "utf8");
	// 快照一并返回：门禁（域名白名单与危险动作开关）和配置物化读的是同一份事实源，
	// 不该为此再读一次文件、也不该出现两份可能不同步的解析。
	return { configPath, snapshot };
}
