// @vitest-environment jsdom
/**
 * 纹理选择的读写与目录/实现表的对齐：这两件事决定新会话页开页时画什么，
 * 脏值与新增档位最容易在这里出错。
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
	DEFAULT_NEW_SESSION_TEXTURE_ID,
	getStoredNewSessionTextureId,
	isNewSessionTextureId,
	NEW_SESSION_TEXTURE_CATALOG,
	NEW_SESSION_TEXTURE_COMPONENTS,
	setStoredNewSessionTextureId,
} from "./new-session-texture";

beforeEach(() => {
	window.localStorage.clear();
});

describe("新会话页纹理", () => {
	it("没选过时是网格，选过之后读回选的那档", () => {
		expect(getStoredNewSessionTextureId()).toBe("grid");
		expect(DEFAULT_NEW_SESSION_TEXTURE_ID).toBe("grid");

		setStoredNewSessionTextureId("aurora");

		expect(getStoredNewSessionTextureId()).toBe("aurora");
	});

	it("存了别处写进来的脏值时回落到网格，而不是画不出东西", () => {
		window.localStorage.setItem("vetta-new-session-texture", "not-a-texture");

		expect(isNewSessionTextureId("not-a-texture")).toBe(false);
		expect(getStoredNewSessionTextureId()).toBe("grid");
	});

	it("目录与实现表逐项对齐：漏挂组件的那档在设置页点得到却画不出东西", () => {
		for (const entry of NEW_SESSION_TEXTURE_CATALOG) {
			expect(entry.id in NEW_SESSION_TEXTURE_COMPONENTS).toBe(true);
		}
		expect(Object.keys(NEW_SESSION_TEXTURE_COMPONENTS).sort()).toEqual(
			NEW_SESSION_TEXTURE_CATALOG.map((entry) => entry.id).sort(),
		);
	});
});
