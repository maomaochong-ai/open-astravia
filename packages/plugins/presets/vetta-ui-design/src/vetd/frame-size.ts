/**
 * 每个画框最终用哪个尺寸。
 *
 * 这里的取舍变过一次。原来漏声明的画框直接不上画布，理由是「静默回落会让 agent
 * 以为自己写对了」。实测下来那个理由站不住：漏声明的代价不是「尺寸不对」，而是
 * 画布上**什么都没有**——没有画板，没有徽标，没有占位。用户盯着空白，agent 拿不到
 * 任何信号，于是开始盲猜（实测现场：先去 edit 一个不存在的 manifest.json，再直接
 * 改 .vetd），画布空了两分多钟。
 *
 * 两种失败摆在一起，方向是清楚的：
 * - 尺寸猜错了 —— 看得见，一眼就发现，改一行就好
 * - 画框不存在 —— 看不见，只能靠 agent 主动查状态才知道
 *
 * 所以改成 fail-open。关键是「渲染」和「报错」本来就是两件事，可以都要：画框照常
 * 上画布，`frame-size-missing` 照常从 checkSources 报出去、照常在轮次结束退回。
 * agent 该补的声明一条都没少，只是补之前画布不再是空的。
 */
import type { FrameMeta } from "./manifest-types";
import type { ParsedFrameMeta } from "./frame-meta";

export interface FrameSize {
	width: number;
	height: number;
}

/**
 * 整份设计一个尺寸都没声明时的最后兜底。
 *
 * 取桌面尺寸而不是手机：SKILL.md 里写着「a dashboard at 390 wide is the most
 * common failure」——猜宽了顶多留白，猜窄了整个布局是塌的。
 */
export const FALLBACK_FRAME_SIZE: FrameSize = { width: 1440, height: 900 };

export interface FrameSizeInput {
	id: string;
	/** 从 tsx 解析出来的声明，尺寸可能是 null。 */
	parsed: ParsedFrameMeta;
	/** 这一帧已经在 manifest 里时，上次同步到的声明。 */
	existing: FrameMeta | null;
}

/** 这一帧自己说了算的尺寸：tsx 声明优先，其次是它上次同步到的声明。 */
function declaredSize(entry: FrameSizeInput): FrameSize | null {
	if (entry.parsed.width !== null && entry.parsed.height !== null) {
		return { width: entry.parsed.width, height: entry.parsed.height };
	}
	if (entry.existing) return { width: entry.existing.width, height: entry.existing.height };
	return null;
}

/**
 * 整份设计里出现最多的那个尺寸。
 *
 * 比「抄前一帧」稳：一份设计通常只有一个品类，多数派就是它。而按文件名顺序抄前
 * 一帧有个断链问题——排在最前面那个漏了声明，它自己没有参考、也就进不了参考池，
 * 后面每一帧跟着一起断，最后整份设计一个画框都剩不下（实测就是这么全军覆没的）。
 */
function dominantSize(entries: readonly FrameSizeInput[]): FrameSize | null {
	const counts = new Map<string, { size: FrameSize; count: number }>();
	for (const entry of entries) {
		const size = declaredSize(entry);
		if (!size) continue;
		const key = `${size.width}x${size.height}`;
		const hit = counts.get(key);
		if (hit) hit.count += 1;
		else counts.set(key, { size, count: 1 });
	}
	let best: { size: FrameSize; count: number } | null = null;
	for (const candidate of counts.values()) {
		// 并列时保留先遇到的：entries 已按文件名排序，结果才是稳定的。
		if (!best || candidate.count > best.count) best = candidate;
	}
	return best?.size ?? null;
}

/**
 * 解析每一帧最终的尺寸。返回的 Map 一定覆盖全部输入——没有画框会因为漏声明而
 * 掉出画布。
 */
export function resolveFrameSizes(entries: readonly FrameSizeInput[]): Map<string, FrameSize> {
	const dominant = dominantSize(entries);
	const resolved = new Map<string, FrameSize>();
	for (const entry of entries) {
		resolved.set(entry.id, declaredSize(entry) ?? dominant ?? FALLBACK_FRAME_SIZE);
	}
	return resolved;
}
