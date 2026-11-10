import { describe, expect, test } from "vitest";
import {
	COMPACTION_HEADROOM_PERCENT,
	COMPACTION_KEEP_TOKENS_FLOOR,
	DEFAULT_COMPACTION_SETTINGS,
	getCompactThreshold,
	KEEP_RECENT_WINDOW_CAP_PERCENT,
	planCompactionKeepTokens,
} from "../src/compaction/index.js";

describe("planCompactionKeepTokens", () => {
	test("大窗口沿用配置里的保留量，不改变现有压缩结果", () => {
		const contextWindow = 200_000;
		expect(planCompactionKeepTokens({ contextWindow, settings: DEFAULT_COMPACTION_SETTINGS })).toBe(
			DEFAULT_COMPACTION_SETTINGS.keepRecentTokens,
		);
	});

	test("小窗口按窗口比例收窄保留段，避免压缩完仍贴着阈值", () => {
		const contextWindow = 32_000;
		const keep = planCompactionKeepTokens({ contextWindow, settings: DEFAULT_COMPACTION_SETTINGS });
		const threshold = getCompactThreshold(contextWindow, DEFAULT_COMPACTION_SETTINGS);
		expect(keep).toBe((contextWindow * KEEP_RECENT_WINDOW_CAP_PERCENT) / 100);
		// 压缩后至少还能再长这么多才回到阈值。
		expect(threshold - keep).toBeGreaterThanOrEqual((contextWindow * COMPACTION_HEADROOM_PERCENT) / 100);
	});

	test("上次压缩后仍高于目标线时，按超出量等额收紧下次保留段", () => {
		const contextWindow = 200_000;
		const threshold = getCompactThreshold(contextWindow, DEFAULT_COMPACTION_SETTINGS);
		const target = threshold - (contextWindow * COMPACTION_HEADROOM_PERCENT) / 100;
		const previousKeepTokens = 20_000;
		const tokensAfter = target + 6_000;
		expect(
			planCompactionKeepTokens({
				contextWindow,
				settings: DEFAULT_COMPACTION_SETTINGS,
				previousKeepTokens,
				previousTokensAfterCompaction: tokensAfter,
			}),
		).toBe(previousKeepTokens - 6_000);
	});

	test("收紧是逐步收敛而不是振荡：一步收敛到目标线", () => {
		const contextWindow = 64_000;
		const settings = { ...DEFAULT_COMPACTION_SETTINGS, keepRecentTokens: 20_000 };
		const threshold = getCompactThreshold(contextWindow, settings);
		const target = threshold - (contextWindow * COMPACTION_HEADROOM_PERCENT) / 100;
		const first = planCompactionKeepTokens({ contextWindow, settings });
		// 第一次压完仍在目标线之上：差多少就再削多少。
		const after = target + 4_000;
		const second = planCompactionKeepTokens({
			contextWindow,
			settings,
			previousKeepTokens: first,
			previousTokensAfterCompaction: after,
		});
		expect(second).toBe(first - 4_000);
		// 第二次落在目标线之下后不再收紧。
		const third = planCompactionKeepTokens({
			contextWindow,
			settings,
			previousKeepTokens: second,
			previousTokensAfterCompaction: target - 1_000,
		});
		expect(third).toBe(first);
	});

	test("保留段不会削到零：低于下限时停在下限", () => {
		const contextWindow = 8_000;
		const keep = planCompactionKeepTokens({
			contextWindow,
			settings: DEFAULT_COMPACTION_SETTINGS,
			previousKeepTokens: 3_000,
			previousTokensAfterCompaction: 100_000,
		});
		expect(keep).toBe(COMPACTION_KEEP_TOKENS_FLOOR);
	});

	test("非法窗口长度不计较比例，退回配置值", () => {
		expect(planCompactionKeepTokens({ contextWindow: 0, settings: DEFAULT_COMPACTION_SETTINGS })).toBe(
			DEFAULT_COMPACTION_SETTINGS.keepRecentTokens,
		);
	});
});
