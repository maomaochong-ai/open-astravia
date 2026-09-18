/**
 * 免 Key 目录的代际收敛:把各家还没正式下线、但已被新一代取代的模型归入「历史」。
 *
 * models.dev 的 `status` 只有空值 / `deprecated` / `beta` 三种,而各家的老模型在正式停服前
 * 一直是空值——o3、gpt-4o、gemini-2.5-pro、qwen2.5 全家都算「在售」。只靠 status 过滤,
 * 免 Key 的模型列表会长到没法看(实测 8 家共 174 个)。
 *
 * 又不能回去写静态白名单:ADR-0050 已经证明手写表跟不上各家发版节奏,一旦腐烂就是模型缺失。
 * 所以这里全部从目录字段推导,不出现任何具体模型名:
 *
 *   1. 不支持工具调用的模型直接剔除——Agent 场景用不了。
 *   2. 折叠日期快照与 `-latest` 别名(`claude-sonnet-4-5-20250929`、`gemini-flash-latest`)。
 *   3. 按「family × 产品档位」分组,每组只留最新一代;同代之间正牌优先于变体
 *      (`-customtools` / `-highspeed` / `-exp`)。
 *   4. 某一组的最新成员比该服务商全局最新发布早 14 个月以上,整组归入历史——
 *      这是清掉 o3、qwen-turbo 这类「厂商不再更新的独立档位」的唯一手段:
 *      它们在组内永远是「最新一代」,只按第 3 条过滤反而会把它们留下。
 *
 * 阈值取 14 个月而非更短,是因为「厂商就是没更新」与「模型过时」无法从数据上区分:
 * Claude Haiku 4.5 发布十个多月没有继任者,它仍是该档唯一在售选项,窗口再窄就会误杀。
 */

/** 分组停更多久算过时。见文件头第 4 条。 */
const STALE_GROUP_MS = 14 * 30.5 * 24 * 60 * 60 * 1000;

/** `-20250929` / `-2024-08-06` / `-0309` 这类版本快照后缀。 */
const SNAPSHOT_SUFFIX = /-(?:20\d{6}|20\d{2}-\d{2}-\d{2}|\d{4})$/;

/** 同代里排在正牌后面的变体后缀。 */
const VARIANT_SUFFIX = /-(?:customtools|highspeed|exp|experimental|preview|latest|chat)(?:-|$)/;

/**
 * 产品档位词。用于在同一 family 内区分「旗舰 / 快档 / 代码档」等平行产品线——
 * 各家 family 粒度差别很大(Anthropic 一档一个 family,阿里几乎全叫 `qwen`),
 * 只靠 family 分组会把 qwen 的 max / plus / flash 全并成一组,每组留一个就丢档位。
 */
const TIER_WORDS =
	/^(?:pro|mini|nano|flash|flashx|lite|turbo|max|plus|air|codex|spark|coder|omni|instruct|next|sol|luna|terra|astra|vl|v|it)$/;

/**
 * 推理开关不是产品档位。`grok-4.20-0309-reasoning` / `-non-reasoning` 是同一模型的两种模式,
 * 当成独立档位会让它们各自成为「该档最新」,躲过代际收敛。
 */
const MODE_WORDS = /^(?:reasoning|non|thinking|chat)$/;

/** 系列名,不是档位——`gpt-5.6-sol` 的档位是 sol,`claude-opus-5` 的档位为空(旗舰)。 */
const SERIES_WORDS =
	/^(?:gpt|claude|gemini|gemma|grok|glm|qwen|qwq|qvq|kimi|deepseek|chatgpt|sonnet|opus|haiku|fable|build|k|o)$/;

/** 参数量标记(`27b`、`235b-a22b`):开源权重档,同一 family 下并成一组即可。 */
const PARAM_SIZE = /\d+b(?:-|$)|a\d+b/;

export interface TierInput {
	readonly id: string;
	readonly family?: string;
	readonly releaseDate?: string;
	readonly toolCall?: boolean;
}

/** `2026-07` / `2026-07-09` 都要能解析——models.dev 上两种精度都有。 */
export function parseReleaseDate(value: string | undefined): number {
	if (!value) return Number.NaN;
	const [year, month, day] = value.split("-");
	return Date.parse(`${year}-${month ?? "01"}-${day ?? "01"}T00:00:00Z`);
}

/** 模型所属的「family × 档位」分组。同组内只有最新一代进当前区。 */
export function groupKeyOf(id: string, family: string | undefined): string {
	const base = id
		.replace(SNAPSHOT_SUFFIX, "")
		.replace(/-preview.*$/, "")
		.replace(/-latest$/, "");
	if (PARAM_SIZE.test(base)) return `${family ?? "?"}|open`;
	const tiers = base
		.split(/[-.]/)
		.filter((segment) => segment && !/^\d/.test(segment) && !/^[a-z]?\d+[a-z]?$/.test(segment))
		.filter((segment) => TIER_WORDS.test(segment) && !SERIES_WORDS.test(segment) && !MODE_WORDS.test(segment));
	return `${family ?? "?"}|${tiers.join("-")}`;
}

/**
 * 从一家的模型里挑出「当前区」的 id。入参应当已经过 status / 模态 / isChatModel 过滤。
 * 返回的集合之外一律视为历史模型——只影响免 Key 的默认展示,不删任何模型。
 */
export function selectCurrentModelIds(models: readonly TierInput[]): Set<string> {
	const ids = new Set(models.map((model) => model.id));
	const candidates = models.filter((model) => {
		if (model.toolCall === false) return false;
		if (/-latest$/.test(model.id)) return false;
		// 日期快照只在同名别名也在列表里时折叠:别名不存在时它就是该模型唯一的 id。
		const undated = model.id.replace(SNAPSHOT_SUFFIX, "");
		return undated === model.id || !ids.has(undated);
	});
	if (candidates.length === 0) return new Set();

	const groups = new Map<string, TierInput[]>();
	for (const model of candidates) {
		const key = groupKeyOf(model.id, model.family);
		const group = groups.get(key);
		if (group) group.push(model);
		else groups.set(key, [model]);
	}

	const newest = Math.max(...candidates.map((model) => parseReleaseDate(model.releaseDate) || 0));
	const current = new Set<string>();
	for (const group of groups.values()) {
		const groupNewest = Math.max(...group.map((model) => parseReleaseDate(model.releaseDate) || 0));
		// 没有任何日期可参考时保留(信息不足不该当成过时),有日期才判停更。
		if (Number.isFinite(newest) && groupNewest > 0 && newest - groupNewest > STALE_GROUP_MS) continue;
		const [head] = [...group].sort(compareWithinGroup);
		if (head) current.add(head.id);
	}
	return current;
}

/** 组内排序:先按发布时间降序,同代正牌优先于变体,再按 id 短的优先。 */
function compareWithinGroup(a: TierInput, b: TierInput): number {
	const byDate = (parseReleaseDate(b.releaseDate) || 0) - (parseReleaseDate(a.releaseDate) || 0);
	if (byDate !== 0) return byDate;
	const byVariant = Number(VARIANT_SUFFIX.test(a.id)) - Number(VARIANT_SUFFIX.test(b.id));
	if (byVariant !== 0) return byVariant;
	return a.id.length - b.id.length || a.id.localeCompare(b.id);
}
