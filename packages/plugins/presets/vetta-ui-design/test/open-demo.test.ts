import { describe, expect, it } from "vitest";
import { demoTempFileName, OPEN_DEMO_SCRIPT } from "../src/gallery/open-demo";

describe("demoTempFileName", () => {
	it("只保留 slug 字符，防止拼进临时路径的名字带穿越", () => {
		expect(demoTempFileName("linear")).toBe("vetta-demo-linear.html");
		expect(demoTempFileName("../..//etc")).toBe("vetta-demo-etc.html");
		expect(demoTempFileName("!!!")).toBe("vetta-demo-demo.html");
	});
});

describe("OPEN_DEMO_SCRIPT", () => {
	it("内容与文件名都从 env 取，argv 里没有任何用户数据", () => {
		expect(OPEN_DEMO_SCRIPT).toContain("VETD_DEMO_HTML");
		expect(OPEN_DEMO_SCRIPT).toContain("VETD_DEMO_FILE");
		// 双保险：即使调用方没清洗，脚本内也只取 basename。
		expect(OPEN_DEMO_SCRIPT).toContain("path.basename");
	});

	it("缺 payload 时报错退出，而不是打开一个空文件", () => {
		expect(OPEN_DEMO_SCRIPT).toContain("process.exit(2)");
	});
});
