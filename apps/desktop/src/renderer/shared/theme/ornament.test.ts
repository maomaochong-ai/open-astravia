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

	it.each(ORNAMENT_CATALOG)("保存并读回 $id", ({ id }) => {
		setStoredOrnamentId(id);

		expect(getStoredOrnamentId()).toBe(id);
	});
});
