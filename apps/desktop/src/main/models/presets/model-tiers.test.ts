import { describe, expect, it } from "vitest";
import { groupKeyOf, parseReleaseDate, selectCurrentModelIds, type TierInput } from "./model-tiers.js";

/** 目录条目最少给 id + 发布日期,family 缺省时按「未知家族」归组。 */
function model(id: string, releaseDate: string, extra: Partial<TierInput> = {}): TierInput {
	return { id, releaseDate, ...extra };
}

describe("parseReleaseDate", () => {
	it("按月精度给出的发布日期也能解析", () => {
		// models.dev 上阿里那批老模型只给到 `2025-04`,当成缺失会让整组躲过代际收敛。
		expect(parseReleaseDate("2025-04")).toBe(Date.parse("2025-04-01T00:00:00Z"));
		expect(parseReleaseDate("2025-04-16")).toBe(Date.parse("2025-04-16T00:00:00Z"));
		expect(parseReleaseDate(undefined)).toBeNaN();
	});
});

describe("groupKeyOf", () => {
	it.each([
		["旗舰档不带档位词", "claude-opus-5", "claude-opus", "claude-opus|"],
		["档位词进分组", "gpt-5.4-mini", "gpt-mini", "gpt-mini|mini"],
		["同 family 内按档位区分", "qwen3.8-max", "qwen", "qwen|max"],
		["参数量视为开源权重档", "qwen3-235b-a22b", "qwen", "qwen|open"],
		["日期快照与别名同组", "claude-sonnet-4-5-20250929", "claude-sonnet", "claude-sonnet|"],
		["preview 后缀不影响分组", "gemini-3.1-pro-preview", "gemini-pro", "gemini-pro|pro"],
		["推理模式不是档位", "grok-4.20-0309-reasoning", "grok", "grok|"],
	])("%s", (_name, id, family, expected) => {
		expect(groupKeyOf(id, family)).toBe(expected);
	});

	it("同一模型的推理开关两种模式与旗舰归为一组", () => {
		// 否则 `-reasoning` / `-non-reasoning` 各自都是「该档最新」,代际收敛就对它们失效。
		expect(groupKeyOf("grok-4.20-0309-reasoning", "grok")).toBe(groupKeyOf("grok-4.6", "grok"));
	});
});

describe("selectCurrentModelIds", () => {
	it("同一档位只保留最新一代", () => {
		const current = selectCurrentModelIds([
			model("glm-5.3", "2026-08-14", { family: "glm" }),
			model("glm-5.2", "2026-06-13", { family: "glm" }),
			model("glm-5", "2026-02-12", { family: "glm" }),
			model("glm-4.6", "2025-09-30", { family: "glm" }),
		]);
		expect([...current]).toEqual(["glm-5.3"]);
	});

	it("平行档位各自保留最新一代", () => {
		const current = selectCurrentModelIds([
			model("gpt-5.6", "2026-07-09", { family: "gpt-sol" }),
			model("gpt-5.5", "2026-04-23", { family: "gpt" }),
			model("gpt-5.4-mini", "2026-03-17", { family: "gpt-mini" }),
			model("gpt-5-mini", "2025-08-07", { family: "gpt-mini" }),
		]);
		expect([...current].sort()).toEqual(["gpt-5.4-mini", "gpt-5.5", "gpt-5.6"]);
	});

	it("不支持工具调用的模型不进当前区", () => {
		// Agent 场景调不了工具的模型没有意义,留在列表里只会被选中后报错。
		const current = selectCurrentModelIds([
			model("qwen-plus-character-ja", "2026-09-01", { family: "qwen", toolCall: false }),
			model("qwen3.8-max", "2026-08-03", { family: "qwen" }),
		]);
		expect([...current]).toEqual(["qwen3.8-max"]);
	});

	it("日期快照折叠到同名别名下", () => {
		const current = selectCurrentModelIds([
			model("claude-sonnet-5", "2026-06-29", { family: "claude-sonnet" }),
			model("claude-sonnet-5-20260629", "2026-06-29", { family: "claude-sonnet" }),
		]);
		expect([...current]).toEqual(["claude-sonnet-5"]);
	});

	it("没有无日期别名时日期快照本身仍可见", () => {
		// 折叠的前提是别名存在,否则该模型就只有这一个 id,折掉等于删掉。
		const current = selectCurrentModelIds([
			model("claude-opus-4-5-20251101", "2025-11-24", { family: "claude-opus" }),
		]);
		expect([...current]).toEqual(["claude-opus-4-5-20251101"]);
	});

	it("-latest 别名让位给具体版本", () => {
		const current = selectCurrentModelIds([
			model("gemini-3.8-flash", "2026-09-02", { family: "gemini-flash" }),
			model("gemini-flash-latest", "2026-08-13", { family: "gemini-flash" }),
		]);
		expect([...current]).toEqual(["gemini-3.8-flash"]);
	});

	it("同代之间正牌优先于变体", () => {
		const current = selectCurrentModelIds([
			model("gemini-3.1-pro-preview", "2026-02-19", { family: "gemini-pro" }),
			model("gemini-3.1-pro-preview-customtools", "2026-02-19", { family: "gemini-pro" }),
		]);
		expect([...current]).toEqual(["gemini-3.1-pro-preview"]);
	});

	it("停更超过阈值的整个档位收进历史", () => {
		// o3 / o3-pro 这类在自己组里永远是「最新一代」,只按代际过滤反而会把它们留下。
		const current = selectCurrentModelIds([
			model("gpt-6-astra", "2026-09-04", { family: "gpt-astra" }),
			model("o3", "2025-04-16", { family: "o" }),
			model("o3-pro", "2025-06-10", { family: "o-pro" }),
		]);
		expect([...current]).toEqual(["gpt-6-astra"]);
	});

	it("厂商尚未更新但仍在阈值内的档位保留", () => {
		// Claude Haiku 4.5 发布十个多月没有继任者,它仍是该档唯一在售选项,不能误杀。
		const current = selectCurrentModelIds([
			model("claude-fable-5-1", "2026-09-01", { family: "claude-fable" }),
			model("claude-haiku-4-5", "2025-10-15", { family: "claude-haiku" }),
		]);
		expect([...current].sort()).toEqual(["claude-fable-5-1", "claude-haiku-4-5"]);
	});

	it("缺少发布日期时不按停更淘汰", () => {
		// 信息不足不该当成过时——否则上游漏填一个字段就让该模型凭空消失。
		const current = selectCurrentModelIds([
			model("kimi-k3", "2026-07-16", { family: "kimi-k3" }),
			{ id: "kimi-mystery", family: "kimi-mystery" },
		]);
		expect([...current].sort()).toEqual(["kimi-k3", "kimi-mystery"]);
	});

	it("空目录返回空集合", () => {
		expect(selectCurrentModelIds([]).size).toBe(0);
	});
});
