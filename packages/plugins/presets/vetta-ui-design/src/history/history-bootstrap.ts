/**
 * 设计打开时把历史接上（ADR-0069）。
 *
 * 懒初始化而不是只在 `vetd_create` 时建：用户手里已经存在的设计、以及从 `.vetdz`
 * 导入的设计，都必须能享受到版本历史，而它们不会再经过一次创建流程。
 */
import type { PluginContext } from "@vetta-org/plugin-sdk";
import type { DesignSession } from "../vetd/design-session";
import { ensureDesignIgnored } from "../vetd/design-ignore";
import { commitHistory, ensureHistory } from "./history-client";
import { exitPeek } from "./peek";

/** 每个设计目录只跑一次；同一次会话里反复打开画布不重复走。 */
const bootstrapped = new Map<string, Promise<void>>();

async function bootstrap(ctx: PluginContext, session: DesignSession): Promise<void> {
	const designDir = session.dirPath;
	await ensureDesignIgnored(ctx.fs, designDir);
	const { hasCommits } = await ensureHistory(ctx, designDir);
	// 标记还在，说明上次查看旧版本时崩溃/强退了——工作区里现在装的是旧版本。
	// 先退回最新版，再谈其它，否则用户会以为自己的设计被改回去了。
	await exitPeek(ctx, session);
	// 老设计接入的那一刻，先把「现在这个样子」封存成基础版本——在此之前的迭代
	// 没有被记录过，拿不回来了，但从这一刻起不再丢。
	if (!hasCommits) await commitHistory(ctx, designDir, "初始状态");
}

/**
 * 接上历史。失败只写日志：历史不可用是功能缺失，不该让设计打不开。
 */
export function bootstrapHistory(ctx: PluginContext, session: DesignSession): Promise<void> {
	const designDir = session.dirPath;
	const existing = bootstrapped.get(designDir);
	if (existing) return existing;
	const promise = bootstrap(ctx, session).catch((error: unknown) => {
		bootstrapped.delete(designDir);
		console.warn("[vetta-ui-design] 设计历史初始化失败", error);
	});
	bootstrapped.set(designDir, promise);
	return promise;
}

/** 测试用：清掉「已初始化」记忆。 */
export function resetHistoryBootstrap(): void {
	bootstrapped.clear();
}
