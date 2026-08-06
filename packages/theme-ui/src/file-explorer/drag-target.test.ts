import { describe, expect, test } from "vitest";
import { isDragLeavingElement } from "./drag-target";

describe("isDragLeavingElement", () => {
	test("true when relatedTarget is null", () => {
		expect(
			isDragLeavingElement({
				currentTarget: { contains: () => false } as unknown as EventTarget,
				relatedTarget: null,
			}),
		).toBe(true);
	});

	test("false when relatedTarget is still inside currentTarget", () => {
		const child = {} as EventTarget;
		expect(
			isDragLeavingElement({
				currentTarget: {
					contains: (node: Node) => node === (child as unknown as Node),
				} as unknown as EventTarget,
				relatedTarget: child,
			}),
		).toBe(false);
	});

	test("true when relatedTarget is outside", () => {
		expect(
			isDragLeavingElement({
				currentTarget: { contains: () => false } as unknown as EventTarget,
				relatedTarget: {} as EventTarget,
			}),
		).toBe(true);
	});
});
