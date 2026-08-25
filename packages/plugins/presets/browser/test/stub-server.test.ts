import { describe, expect, it } from "vitest";
// @ts-expect-error -- wrapper 侧是无构建的 .mjs，没有类型声明。
import { handleStubMessage, setupGuidance } from "../scripts/lib/stub-server.mjs";
// @ts-expect-error -- 同上。
import { pluginDataDir, vettaHomeDir, wrapperRuntimePath } from "../scripts/lib/paths.mjs";

function call(method: string, id: unknown = 1): unknown {
	const raw = handleStubMessage({ jsonrpc: "2.0", id, method }, "binary-missing");
	return raw === null ? null : JSON.parse(raw as string);
}

describe("stub server", () => {
	it("能完成 initialize 握手 —— 否则宿主只会在日志里留一条启动失败，模型侧完全无感", () => {
		const response = call("initialize") as { result: { capabilities: unknown; protocolVersion: string } };
		expect(response.result.protocolVersion).toBeTruthy();
		expect(response.result.capabilities).toHaveProperty("tools");
	});

	it("只暴露一个引导工具，不复制真工具面（那会与上游漂移）", () => {
		const response = call("tools/list") as { result: { tools: Array<{ name: string }> } };
		expect(response.result.tools).toHaveLength(1);
		expect(response.result.tools[0].name).toBe("agent_browser_setup_required");
	});

	it("任何调用都返回 isError + 可转述的引导文案", () => {
		const response = call("tools/call") as { result: { isError: boolean; content: Array<{ text: string }> } };
		expect(response.result.isError).toBe(true);
		expect(response.result.content[0].text).toContain("浏览器操作");
	});

	it("通知（无 id）不回包，避免污染 stdio 流", () => {
		expect(handleStubMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, "binary-missing")).toBeNull();
	});

	it("未知方法返回标准 method-not-found", () => {
		const response = call("does/not/exist") as { error: { code: number } };
		expect(response.error.code).toBe(-32601);
	});

	it("不同失败原因给不同引导 —— 未安装要引导去装，其他情况引导去看面板", () => {
		expect(setupGuidance("binary-missing")).toContain("安装");
		expect(setupGuidance("config-failed")).toContain("查看具体原因");
	});

	it("版本过旧走独立分支，不会被当成未安装", () => {
		expect(setupGuidance("version-too-old", { version: "0.25.4" })).toContain("0.25.4");
	});
});

describe("wrapper 路径解析", () => {
	it("默认落在 ~/.vetta", () => {
		expect(vettaHomeDir({}, "/home/u")).toBe("/home/u/.vetta");
	});

	it("尊重 VETTA_CONFIG_DIR —— 开发态用它隔离环境，wrapper 必须跟着走", () => {
		expect(vettaHomeDir({ VETTA_CONFIG_DIR: ".vetta-dev" }, "/home/u")).toBe("/home/u/.vetta-dev");
	});

	it("VETTA_HOME 优先，且支持 ~ 展开", () => {
		expect(vettaHomeDir({ VETTA_HOME: "~/custom" }, "/home/u")).toBe("/home/u/custom");
		expect(vettaHomeDir({ VETTA_HOME: "/abs/root", VETTA_CONFIG_DIR: ".x" }, "/home/u")).toBe("/abs/root");
	});

	it("插件数据目录与宿主 storage 的物理路径一致", () => {
		expect(pluginDataDir({}, "/home/u")).toBe("/home/u/.vetta/plugin-data/browser");
		expect(wrapperRuntimePath({}, "/home/u")).toBe("/home/u/.vetta/plugin-data/browser/runtime.json");
	});
});
