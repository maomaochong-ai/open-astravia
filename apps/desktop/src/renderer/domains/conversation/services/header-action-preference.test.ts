import { describe, expect, it } from "vitest";
import {
	applyHeaderActionOrder,
	EMPTY_HEADER_ACTION_PREFERENCE,
	moveHeaderAction,
	parseHeaderActionPreference,
	serializeHeaderActionPreference,
} from "./header-action-preference";

const actions = [{ id: "export" }, { id: "pin" }, { id: "terminal" }, { id: "panel" }];

/**
 * 顶栏顺序偏好的三条规则：用户排过的先按用户顺序、新增的接在后面、已卸载的忽略。
 * 任何一条错了，用户升级后都会觉得「我常用的按钮不见了」。
 */
describe("顶栏动作顺序偏好", () => {
	it("没有偏好时保持宿主给的顺序", () => {
		expect(applyHeaderActionOrder(actions, [])).toEqual(actions);
	});

	it("按偏好重排，偏好里没有的动作接在后面而不是丢失", () => {
		const ordered = applyHeaderActionOrder(actions, ["panel", "export"]);
		expect(ordered.map((item) => item.id)).toEqual(["panel", "export", "pin", "terminal"]);
	});

	it("偏好里有但宿主已不提供的 id 被忽略（插件卸载）", () => {
		const ordered = applyHeaderActionOrder(actions, ["uninstalled-plugin", "terminal"]);
		expect(ordered.map((item) => item.id)).toEqual(["terminal", "export", "pin", "panel"]);
	});

	it("移动：把某项移到另一项的位置", () => {
		expect(moveHeaderAction(["a", "b", "c", "d"], "a", "c")).toEqual(["b", "c", "a", "d"]);
		expect(moveHeaderAction(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
	});

	it("移动到自身或未知 id 时原样返回，不产生空位", () => {
		expect(moveHeaderAction(["a", "b"], "a", "a")).toEqual(["a", "b"]);
		expect(moveHeaderAction(["a", "b"], "zzz", "a")).toEqual(["a", "b"]);
	});

	it("坏数据回落为空偏好，不让存储内容影响渲染", () => {
		expect(parseHeaderActionPreference(undefined)).toEqual(EMPTY_HEADER_ACTION_PREFERENCE);
		expect(parseHeaderActionPreference("{not json")).toEqual(EMPTY_HEADER_ACTION_PREFERENCE);
		expect(parseHeaderActionPreference(JSON.stringify({ order: "nope" }))).toEqual(EMPTY_HEADER_ACTION_PREFERENCE);
	});

	it("去重：同一 id 重复出现只保留一次", () => {
		const parsed = parseHeaderActionPreference(JSON.stringify({ order: ["a", "a", "b"], hidden: ["b", "b"] }));
		expect(parsed.order).toEqual(["a", "b"]);
		expect(parsed.hidden).toEqual(["b"]);
	});

	it("序列化后可原样解析回来", () => {
		const preference = { order: ["panel", "export"], hidden: ["pin"] };
		expect(parseHeaderActionPreference(serializeHeaderActionPreference(preference))).toEqual(preference);
	});
});
