import { describe, expect, it } from "vitest";
import { defaultOptions, normalizeOptions } from "../src/mockup/options";

const fallback = defaultOptions(800);

describe("normalizeOptions", () => {
	it("defaults to three frames per image", () => {
		expect(fallback.perPage).toBe(3);
	});

	// 老版本存下来的设置里没有 perPage。整体校验会因此把整份偏好丢掉——
	// 用户的圆角、边框、背景色会在升级后无声复位。
	it("keeps settings saved before perPage existed", () => {
		const legacy = { ...fallback, borderWidth: 30, background: "#ffffff" };
		delete (legacy as Record<string, unknown>).perPage;
		const normalized = normalizeOptions(legacy, fallback);
		expect(normalized.borderWidth).toBe(30);
		expect(normalized.background).toBe("#ffffff");
		expect(normalized.perPage).toBe(fallback.perPage);
	});

	it("rejects out-of-range and wrongly typed fields one by one", () => {
		const normalized = normalizeOptions(
			{ ...fallback, perPage: 7, scale: 3, borderWidth: -2, borderColor: 12, shadow: "yes" },
			fallback,
		);
		expect(normalized.perPage).toBe(fallback.perPage);
		expect(normalized.scale).toBe(fallback.scale);
		expect(normalized.borderWidth).toBe(fallback.borderWidth);
		expect(normalized.borderColor).toBe(fallback.borderColor);
		expect(normalized.shadow).toBe(fallback.shadow);
	});

	it("accepts every allowed page size", () => {
		for (const perPage of [1, 2, 3, 4]) {
			expect(normalizeOptions({ ...fallback, perPage }, fallback).perPage).toBe(perPage);
		}
	});

	it("falls back entirely on garbage", () => {
		expect(normalizeOptions(null, fallback)).toEqual(fallback);
		expect(normalizeOptions("nope", fallback)).toEqual(fallback);
	});
});
