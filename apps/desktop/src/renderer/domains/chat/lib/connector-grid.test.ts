import { describe, expect, it } from "vitest";
import { connectorGridColumns } from "./connector-grid";

describe("connectorGridColumns", () => {
	it("命中约定的形态", () => {
		expect(connectorGridColumns(2)).toBe(2);
		expect(connectorGridColumns(3)).toBe(3);
		expect(connectorGridColumns(4)).toBe(2);
		expect(connectorGridColumns(5)).toBe(3);
		expect(connectorGridColumns(6)).toBe(3);
	});

	it("边界：1 撑满一行，7 走 4 列", () => {
		expect(connectorGridColumns(1)).toBe(1);
		expect(connectorGridColumns(7)).toBe(4);
	});

	it("内置预设最多 8 个，都不会让末行只剩 1 个", () => {
		for (let count = 2; count <= 8; count++) {
			const columns = connectorGridColumns(count);
			const remainder = count % columns;
			expect(remainder === 0 || remainder > 1).toBe(true);
		}
	});
});
