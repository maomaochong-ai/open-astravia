import type { Api, Model } from "@astravia/ai";

/**
 * 压缩摘要模型分级：宿主可注入「主模型 → 摘要模型」解析，让摘要生成跑在
 * 轻量模型上（摘要是复读提炼任务，#9 已降推理档，换模型是速度收益的另一半）。
 *
 * 关键约束（实现与宿主接线都要遵守）：
 * - 返回 undefined / 未注入 → 跟随主模型（现状语义，零变化）；
 * - 换绑发生时（swapped=true），会话的 modelBinding.credential 是**主模型**的
 *   绑定，不能给摘要模型用——必须按摘要模型自己的 provider 走 resolveApiKey。
 *   （此点同时是既有代码的隐患：credential 绑定与 model 参数可能不配套。）
 */

export type SummaryModelResolver = (primary: Model<Api>) => Model<Api> | undefined | Promise<Model<Api> | undefined>;

export interface ResolvedSummaryModel {
	/** 实际用于摘要生成的模型。 */
	readonly model: Model<Api>;
	/** 是否发生了换绑（true 时 credential 必须按该模型重新解析）。 */
	readonly swapped: boolean;
}

/**
 * 解析压缩摘要要用的模型。resolver 异常按「跟随主模型」处理（分级是性能
 * 优化，不能因它让压缩失败）。
 */
export async function resolveCompactionSummaryModel(
	primary: Model<Api>,
	resolver: SummaryModelResolver | undefined,
): Promise<ResolvedSummaryModel> {
	if (!resolver) return { model: primary, swapped: false };
	try {
		const resolved = await resolver(primary);
		if (!resolved || resolved === primary) return { model: primary, swapped: false };
		return { model: resolved, swapped: true };
	} catch {
		return { model: primary, swapped: false };
	}
}
