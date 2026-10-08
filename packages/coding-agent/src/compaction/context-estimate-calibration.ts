/**
 * 上下文估算校准（PI #779 已合并思路的 AS 最小化移植）。
 *
 * 问题：估算口径（estimateTokens：ASCII/4、CJK 1/字、其余 1/2）与 provider 真实
 * usage 之间存在系统性残差——系统提示词、工具 schema、缓存写放大都计入 usage 而
 * 不计入逐字估算。残差随会话形态漂移，固定系数修不准；但 provider 每次响应都带
 * 真实 usage，拿它锚定即可。
 *
 * 校准规则（PI #779 的原则，两条界线分开）：
 *   1) 比例合法带 [low, high]：usage/估算 落在带内的锚点才可入库——带内的锚点
 *      哪怕绝对残差很大（大尺度会话的正常现象）也可供比例路径使用；
 *   2) 固定残差上限（FIXED_RESIDUAL_CAP）：固定路径只外推「系统提示词 + 工具
 *      schema」量级的残差——绝对残差超出部分只对比例路径有意义，不进固定项；
 *   3) 比例路径要求锚点「观察到目标尺度本身」（锚点估算 ≥ 目标估算）：100k 样本
 *      对 1M 投影没有比例说服力，只有固定部分可信；
 *   4) 向下突变（usage 低于逐字估算，即残差翻负）连续两次即冻结：口径或会话形
 *      态变了——不吸收新锚点、不清空旧锚点，沿用冻结前的校正。
 */

export interface CalibrationAnchor {
	/** 校准当时的逐字估算（含 trailing） */
	readonly estimateTokens: number;
	/** provider 报告的真实 usage（totalTokens 口径） */
	readonly usageTokens: number;
}

/** 锚点的比例合法带：usage/估算 落在 [low, high] 才可入库。 */
export const ratioBand = {
	low: 0.5,
	/** 估算与 usage 相差 5 倍以上即视为异常样本（估算口径不可能偏这么多）。 */
	high: 5,
	accepts(anchor: CalibrationAnchor): boolean {
		if (!Number.isFinite(anchor.usageTokens) || !Number.isFinite(anchor.estimateTokens)) return false;
		if (anchor.estimateTokens <= 0 || anchor.usageTokens <= 0) return false;
		const ratio = anchor.usageTokens / anchor.estimateTokens;
		return ratio >= ratioBand.low && ratio <= ratioBand.high;
	},
};

/**
 * 固定路径的残差上限：系统提示词 + 全部工具 schema 的量级。
 * 大尺度锚点的更大残差只通过比例路径生效，不作为固定项外推。
 */
const FIXED_RESIDUAL_CAP = 60_000;

/** 连续多少个向下突变样本后冻结校准。 */
const FREEZE_AFTER_DOWNWARD_SAMPLES = 2;

/** 保留的锚点数量上限（滚动窗口）。 */
const MAX_ANCHORS = 8;

interface AcceptedAnchor {
	readonly estimateTokens: number;
	readonly usageTokens: number;
}

export class ContextEstimateCalibration {
	private accepted: AcceptedAnchor[] = [];
	private downwardStreak = 0;
	private frozen = false;

	/** 记录一个锚点；比例带外的样本拒收，连续向下突变触发冻结。 */
	record(anchor: CalibrationAnchor): void {
		if (this.frozen) return;
		if (!ratioBand.accepts(anchor)) return;

		const last = this.accepted[this.accepted.length - 1];
		const negativeResidual = anchor.usageTokens < anchor.estimateTokens;
		const usageCollapsed =
			last !== undefined &&
			anchor.estimateTokens > last.estimateTokens &&
			anchor.usageTokens < last.usageTokens * ratioBand.low;
		if (negativeResidual || usageCollapsed) {
			this.downwardStreak += 1;
			if (this.downwardStreak >= FREEZE_AFTER_DOWNWARD_SAMPLES) this.frozen = true;
			return; // 向下突变样本不进锚点
		}
		this.downwardStreak = 0;

		this.accepted.push({ estimateTokens: anchor.estimateTokens, usageTokens: anchor.usageTokens });
		if (this.accepted.length > MAX_ANCHORS) this.accepted.shift();
	}

	/**
	 * 把逐字估算校正为「带 provider 锚定的估算」。无可用锚点时原样返回。
	 * 只放大、不缩小：估算口径本身已是保守下限，校准只补系统性低估。
	 */
	correct(estimateTokens: number): number {
		// 比例路径：最近的「观察到该尺度」的锚点（锚点估算 ≥ 目标）。
		for (let index = this.accepted.length - 1; index >= 0; index -= 1) {
			const anchor = this.accepted[index];
			if (anchor.estimateTokens < estimateTokens) continue;
			const ratio = anchor.usageTokens / anchor.estimateTokens;
			if (ratio <= 1) return estimateTokens;
			return Math.round(estimateTokens * ratio);
		}
		// 固定路径：没有覆盖该尺度的锚点，用最近锚点的固定残差（有上限）。
		const last = this.accepted[this.accepted.length - 1];
		if (last === undefined) return estimateTokens;
		const fixedResidual = Math.min(last.usageTokens - last.estimateTokens, FIXED_RESIDUAL_CAP);
		return fixedResidual > 0 ? estimateTokens + fixedResidual : estimateTokens;
	}
}
