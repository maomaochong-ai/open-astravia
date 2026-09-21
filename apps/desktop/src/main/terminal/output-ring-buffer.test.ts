import { describe, expect, it } from "vitest";
import { OutputRingBuffer } from "./output-ring-buffer.js";

describe("OutputRingBuffer", () => {
	it("没超上限时原样返回全部内容", () => {
		const buffer = new OutputRingBuffer(32);
		buffer.push("hello ");
		buffer.push("world");

		expect(buffer.read()).toBe("hello world");
		expect(buffer.isTruncated()).toBe(false);
	});

	it("超出上限丢最旧的块并记下截断", () => {
		const buffer = new OutputRingBuffer(10);
		buffer.push("aaaaa");
		buffer.push("bbbbb");
		buffer.push("ccccc");

		expect(buffer.read()).toBe("bbbbbccccc");
		expect(buffer.isTruncated()).toBe(true);
	});

	it("单块超过上限时保留它，不从中间切断字符", () => {
		const buffer = new OutputRingBuffer(4);
		// 表情符号是代理对：按字节切会切出乱码，所以宁可超上限也整块保留。
		buffer.push("🌟🌟🌟🌟🌟");

		expect(buffer.read()).toBe("🌟🌟🌟🌟🌟");
	});

	it("空块不占位", () => {
		const buffer = new OutputRingBuffer(8);
		buffer.push("");

		expect(buffer.read()).toBe("");
		expect(buffer.length).toBe(0);
	});

	it("清空后截断标记也复位", () => {
		const buffer = new OutputRingBuffer(4);
		buffer.push("aaaa");
		buffer.push("bbbb");
		expect(buffer.isTruncated()).toBe(true);

		buffer.clear();

		expect(buffer.read()).toBe("");
		expect(buffer.isTruncated()).toBe(false);
	});
});
