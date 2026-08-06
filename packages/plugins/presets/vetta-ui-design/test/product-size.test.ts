/**
 * vetd_create 的品类参数。
 *
 * 这组用例守的是那道硬闸：拿不到品类就不该建设计。从前这里没有参数，兜底写死成
 * 桌面 1440x900，「用户要的是移动 App」在整条链路上无处可存。
 */
import { expect, it } from "vitest";
import { PRODUCT_SIZES, resolveDefaultFrameSize } from "../src/vetd/product-size";

it("maps a product type to its default size", () => {
	expect(resolveDefaultFrameSize({ product: "mobile" })).toEqual({ width: 390, height: 844 });
	expect(resolveDefaultFrameSize({ product: "poster" })).toEqual(PRODUCT_SIZES.poster);
});

it("takes an explicit size for what the enum cannot express", () => {
	// 正方形社交图、信息图、A4——枚举里没有，但都要能表达。
	expect(resolveDefaultFrameSize({ frameSize: { width: 1080, height: 1080 } })).toEqual({
		width: 1080,
		height: 1080,
	});
	expect(resolveDefaultFrameSize({ frameSize: { width: 794, height: 1123 } })).toEqual({
		width: 794,
		height: 1123,
	});
});

it("lets an explicit size win over the product type", () => {
	expect(resolveDefaultFrameSize({ product: "mobile", frameSize: { width: 800, height: 800 } })).toEqual({
		width: 800,
		height: 800,
	});
});

it("returns null when neither is given, so the tool can refuse", () => {
	expect(resolveDefaultFrameSize({})).toBeNull();
	expect(resolveDefaultFrameSize({ product: "tablet" })).toBeNull();
});

it("rejects sizes that would put a malformed board on the canvas", () => {
	expect(resolveDefaultFrameSize({ frameSize: { width: 0, height: 800 } })).toBeNull();
	expect(resolveDefaultFrameSize({ frameSize: { width: -390, height: 844 } })).toBeNull();
	expect(resolveDefaultFrameSize({ frameSize: { width: Number.NaN, height: 844 } })).toBeNull();
	expect(resolveDefaultFrameSize({ frameSize: { width: "390", height: 844 } })).toBeNull();
});

it("rounds fractional sizes rather than dropping them", () => {
	// mm→px 换算出小数是正常的，不该因此退回 null。
	expect(resolveDefaultFrameSize({ frameSize: { width: 793.7, height: 1122.5 } })).toEqual({
		width: 794,
		height: 1123,
	});
});
