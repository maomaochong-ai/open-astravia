import type { AgentMessage } from "@astravia/agent-core";
import { describe, expect, it } from "vitest";
import { ContextEstimateCalibration, ratioBand } from "../src/compaction/context-estimate-calibration.js";
import { estimateContextTokens, estimateTextTokens } from "../src/compaction/token-policy.js";

/**
 * 上下文估算校准的回归测试。
 *
 * 背景：估算的 trailing 部分按 estimateTokens 逐字计（ASCII/4、CJK 1、其余 1/2），
 * 与 provider 真实 usage 之间存在系统性残差（系统提示词、schema、缓存写放大计入
 * usage 而不计入逐字估算）。校准用 provider usage 锚定，规则见实现文件头注释。
 */

function userMessage(text: string): AgentMessage {
	return {
		role: "user",
		content: [{ type: "text", text }],
		timestamp: Date.now(),
	} as AgentMessage;
}

const CJK_PARAGRAPH = "这是一段用来校准上下文估算的中文段落，每个汉字按一个 token 计，长度是真实文本而非常数。".repeat(
	40,
);

describe("ContextEstimateCalibration", () => {
	it("无锚点时保持原估算（不放大也不缩小）", () => {
		const calibration = new ContextEstimateCalibration();
		const estimate = estimateTextTokens(CJK_PARAGRAPH);
		expect(calibration.correct(estimate)).toBe(estimate);
	});

	it("锚点未覆盖目标尺度：只外推固定残差（小尺度样本不用比例）", () => {
		const calibration = new ContextEstimateCalibration();
		// 当时口径估 1000，真实 usage 1500 → 固定残差 +500
		calibration.record({ estimateTokens: 1000, usageTokens: 1500 });
		// 下一次估算 2000（锚点只观察到 1000，未覆盖 2000 尺度）→ 固定 +500
		expect(calibration.correct(2000)).toBe(2500);
	});

	it("100k 样本对 1M 投影：只加固定残差，不按比例放大", () => {
		const calibration = new ContextEstimateCalibration();
		calibration.record({ estimateTokens: 100_000, usageTokens: 130_000 }); // +30%，但样本尺度 100k
		// 1M 投影只加固定残差 30k，不乘 1.3
		expect(calibration.correct(1_000_000)).toBe(1_030_000);
	});

	it("锚点观察到目标尺度本身：比例外推生效", () => {
		const calibration = new ContextEstimateCalibration();
		// 该尺度上真实样本：估算 800k，usage 1M（+25%）
		calibration.record({ estimateTokens: 800_000, usageTokens: 1_000_000 });
		expect(calibration.correct(800_000)).toBe(1_000_000);
		// 同尺度稍小的目标也按比例（锚点 800k 覆盖 700k）
		expect(calibration.correct(700_000)).toBe(875_000);
	});

	it("异常 usage 不进锚点：0 / NaN / 爆表值被拒收", () => {
		const calibration = new ContextEstimateCalibration();
		calibration.record({ estimateTokens: 1000, usageTokens: 0 });
		calibration.record({ estimateTokens: 1000, usageTokens: Number.NaN });
		calibration.record({ estimateTokens: 1000, usageTokens: 5_000_000 }); // 残差远超合理带
		const estimate = estimateTextTokens(CJK_PARAGRAPH);
		expect(calibration.correct(estimate)).toBe(estimate); // 等于没有锚点
	});

	it("向下突变连续两次即冻结：冻结后不吸收新锚点，沿用冻结前的校正", () => {
		const calibration = new ContextEstimateCalibration();
		calibration.record({ estimateTokens: 1000, usageTokens: 1200 }); // 固定 +200
		// 两个负残差样本（usage 低于逐字估算）：口径变了
		calibration.record({ estimateTokens: 2000, usageTokens: 1000 }); // 向下 #1，不进锚点
		calibration.record({ estimateTokens: 3000, usageTokens: 1500 }); // 向下 #2 → 冻结
		// 冻结后新锚点被拒
		calibration.record({ estimateTokens: 4000, usageTokens: 9000 });
		// 校正沿用冻结前唯一锚点 (1000,1200) 的固定残差
		expect(calibration.correct(4000)).toBe(4200);
	});

	it("比例合法带（ratioBand）：正常波动接受、离群拒绝", () => {
		// 40k 会话报 300k usage —— 比例 7.5 倍超出合法带上限（5），拒绝
		expect(ratioBand.accepts({ estimateTokens: 40_000, usageTokens: 300_000 })).toBe(false);
		// 正常：估算 40k，usage 52k（比例 1.3）
		expect(ratioBand.accepts({ estimateTokens: 40_000, usageTokens: 52_000 })).toBe(true);
		// 大尺度大残差但比例合理（1.25）：合法（残差只走比例路径，不受固定上限约束）
		expect(ratioBand.accepts({ estimateTokens: 800_000, usageTokens: 1_000_000 })).toBe(true);
	});
});

describe("estimateContextTokens 消费面（usage 锚定开销）", () => {
	function assistantWithUsage(totalTokens: number) {
		return {
			role: "assistant",
			content: [{ type: "text", text: "回复" }],
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens },
			timestamp: Date.now(),
			stopReason: "stop",
		} as unknown as AgentMessage;
	}

	it("usage 远大于逐字前缀（schema 开销大）：估算补上残差", () => {
		// 前缀 10240（40KB ASCII / 4），usage 报 20k → 残差 9760 进入总估算
		const messages: AgentMessage[] = [
			userMessage("x".repeat(40 * 1024)),
			assistantWithUsage(20_000),
			userMessage("y".repeat(4 * 1024)), // trailing 1024
		];
		const estimate = estimateContextTokens(messages);
		// 旧口径 20000 + 1024 = 21024；新口径补残差 9760 → 30784
		expect(estimate.tokens).toBe(30_784);
	});

	it("usage 与逐字口径一致（残差为零）：行为与旧口径完全相同", () => {
		const messages: AgentMessage[] = [
			userMessage("x".repeat(40 * 1024)), // 10240
			assistantWithUsage(10_240), // 与逐字一致 → 残差 0
			userMessage("y".repeat(4 * 1024)), // trailing 1024
		];
		expect(estimateContextTokens(messages).tokens).toBe(11_264);
	});

	it("usage 低于逐字前缀（比例带外）：不校正，只放大不缩小", () => {
		const messages: AgentMessage[] = [
			userMessage("x".repeat(40 * 1024)), // 10240
			assistantWithUsage(1_000), // 比例 0.098 → 拒收，不校正
			userMessage("y".repeat(4 * 1024)), // trailing 1024
		];
		expect(estimateContextTokens(messages).tokens).toBe(2_024);
	});
});

describe("中文估算口径（消费面防回归）", () => {
	it("中文长文本的估算显著高于 chars/4（不许退回老口径）", () => {
		const text = CJK_PARAGRAPH;
		const perChar = text.length / 4;
		expect(estimateTextTokens(text)).toBeGreaterThan(perChar * 3);
	});
});
