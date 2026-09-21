import { describe, expect, it } from "vitest";
import { detectPortsInOutput } from "./detect-ports-in-output";

describe("从任务输出里认出端口", () => {
	it("认出常见开发服务器打出来的地址", () => {
		const output = [
			"  VITE v5.4.2  ready in 421 ms",
			"  ➜  Local:   http://localhost:5173/",
			"  ➜  Network: http://10.0.0.5:5173/",
			"Starting development server at http://127.0.0.1:8000/",
			"Uvicorn running on http://0.0.0.0:8080 (Press CTRL+C to quit)",
			"listening at http://[::1]:4000",
		].join("\n");

		expect(detectPortsInOutput(output)).toEqual([5173, 8000, 8080, 4000]);
	});

	it("同一个端口只算一次，按出现顺序", () => {
		const output = "http://localhost:3000\nrebuilding…\nhttp://localhost:3000\nhttp://localhost:3001";
		expect(detectPortsInOutput(output)).toEqual([3000, 3001]);
	});

	it("不认散句里的端口号——摆一个转不通的端口比少认一个更糟", () => {
		expect(detectPortsInOutput("Connection to port 22 closed.")).toEqual([]);
		expect(detectPortsInOutput("listening on port 3000")).toEqual([]);
		// 不是本机地址：它在远端也不是经回环可达的那个端口。
		expect(detectPortsInOutput("serving on http://192.168.1.20:9000")).toEqual([]);
	});

	it("端口号不合法时跳过", () => {
		expect(detectPortsInOutput("http://localhost:99999 http://localhost:0")).toEqual([]);
	});

	it("空输出与没有地址的输出都给空清单", () => {
		expect(detectPortsInOutput("")).toEqual([]);
		expect(detectPortsInOutput("npm warn deprecated something@1.0.0")).toEqual([]);
	});
});
