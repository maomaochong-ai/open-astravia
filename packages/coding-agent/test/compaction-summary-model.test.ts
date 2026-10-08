import type { Api, Model } from "@astravia/ai";
import { describe, expect, it } from "vitest";
import { resolveCompactionSummaryModel } from "../src/compaction/summary-model.js";

/**
 * 压缩摘要模型分级的回归测试。
 *
 * 背景：#9 把摘要生成的推理档降为 low、输出预算收敛，是「参数面」的速度收益；
 * 换绑轻量模型是「模型面」的另一半。resolveCompactionSummaryModel 是换绑决策
 * 的唯一出口（正式压缩与 prefire 预热共用），语义：
 *   - 未注入 resolver / 返回 undefined / 返回主模型本身 → 跟随主模型（现状）；
 *   - 换绑发生 → swapped=true，宿主必须按摘要模型的 provider 重新解析 credential
 *     （主模型的 modelBinding.credential 不跨 provider 使用）；
 *   - resolver 异常 → 按跟随主模型处理（分级是性能优化，不能让它弄坏压缩）。
 */

const PRIMARY = { id: "main-model", provider: "main-provider" } as unknown as Model<Api>;
const LIGHT = { id: "mini-model", provider: "main-provider" } as unknown as Model<Api>;
const OTHER_PROVIDER = { id: "cheap-model", provider: "other-provider" } as unknown as Model<Api>;

describe("resolveCompactionSummaryModel", () => {
	it("未注入 resolver：跟随主模型，不换绑", async () => {
		const resolved = await resolveCompactionSummaryModel(PRIMARY, undefined);
		expect(resolved.model).toBe(PRIMARY);
		expect(resolved.swapped).toBe(false);
	});

	it("resolver 返回 undefined / 主模型本身：跟随主模型", async () => {
		expect((await resolveCompactionSummaryModel(PRIMARY, () => undefined)).swapped).toBe(false);
		expect((await resolveCompactionSummaryModel(PRIMARY, () => PRIMARY)).swapped).toBe(false);
	});

	it("返回轻量模型：换绑成立（同 provider 也算换绑——credential 语义由宿主决定）", async () => {
		const resolved = await resolveCompactionSummaryModel(PRIMARY, () => LIGHT);
		expect(resolved.model).toBe(LIGHT);
		expect(resolved.swapped).toBe(true);
	});

	it("跨 provider 换绑：模型返回正确（credential 重解析的约束由此标志驱动）", async () => {
		const resolved = await resolveCompactionSummaryModel(PRIMARY, () => OTHER_PROVIDER);
		expect(resolved.model).toBe(OTHER_PROVIDER);
		expect(resolved.swapped).toBe(true);
	});

	it("resolver 异常：按跟随主模型降级，不让分级弄坏压缩", async () => {
		const resolved = await resolveCompactionSummaryModel(PRIMARY, () => {
			throw new Error("model registry unavailable");
		});
		expect(resolved.model).toBe(PRIMARY);
		expect(resolved.swapped).toBe(false);
	});

	it("resolver 支持异步（宿主从模型目录异步解析）", async () => {
		const resolved = await resolveCompactionSummaryModel(PRIMARY, async () => LIGHT);
		expect(resolved.model).toBe(LIGHT);
	});
});
