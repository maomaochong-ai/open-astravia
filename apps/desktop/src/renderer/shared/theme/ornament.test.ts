// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
	DEFAULT_ORNAMENT_ID,
	getStoredOrnamentId,
	isOrnamentId,
	ORNAMENT_CATALOG,
	ORNAMENT_STORAGE_KEY,
	setStoredOrnamentId,
} from "./ornament";

beforeEach(() => {
	window.localStorage.clear();
});

describe("新会话页装饰件", () => {
	it("未选择和存储脏值时使用默认装饰件", () => {
		expect(getStoredOrnamentId()).toBe(DEFAULT_ORNAMENT_ID);

		window.localStorage.setItem(ORNAMENT_STORAGE_KEY, "not-an-ornament");

		expect(isOrnamentId("not-an-ornament")).toBe(false);
		expect(getStoredOrnamentId()).toBe(DEFAULT_ORNAMENT_ID);
	});

	it("从未选过装饰件的用户默认不挂装饰件", () => {
		expect(getStoredOrnamentId()).toBe("none");
	});

	it.each(["blaze", "torch", "orbit", "hand", "well"])("此前选了已移除的「%s」的用户回落到不挂装饰件", (removed) => {
		window.localStorage.setItem(ORNAMENT_STORAGE_KEY, removed);

		expect(getStoredOrnamentId()).toBe("none");
	});

	it.each(ORNAMENT_CATALOG)("保存并读回 $id", ({ id }) => {
		setStoredOrnamentId(id);

		expect(getStoredOrnamentId()).toBe(id);
	});
});
