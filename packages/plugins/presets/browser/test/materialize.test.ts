import { describe, expect, it } from "vitest";
// @ts-expect-error -- wrapper 侧是无构建的 .mjs（宿主用 node 直接跑），没有类型声明。
import { materializeAgentBrowserConfig, normalizeSnapshot } from "../scripts/lib/materialize.mjs";
// @ts-expect-error -- 同上。
import { buildMcpArgv, buildSessionId, SESSION_PREFIX } from "../scripts/lib/argv.mjs";
// @ts-expect-error -- 同上。
import { binaryFileName, resolveAgentBrowserBinary } from "../scripts/lib/resolve-binary.mjs";

const paths = { profileDir: "/data/browser/profile", actionPolicyPath: "/data/browser/action-policy.json" };

describe("normalizeSnapshot", () => {
	it("缺失快照回落到保守默认：禁 eval、禁上传", () => {
		const snapshot = normalizeSnapshot(undefined);
		expect(snapshot).toMatchObject({ browserSource: "managed", denyEval: true, denyUpload: true });
	});

	it("单个坏字段不会连累其余字段 —— 用户改过的值必须保留", () => {
		const snapshot = normalizeSnapshot({ headed: "yes", denyEval: false, maxOutput: 50000 });
		expect(snapshot.headed).toBe(true); // 坏值回落
		expect(snapshot.denyEval).toBe(false); // 用户的选择保留
		expect(snapshot.maxOutput).toBe(50000);
	});

	it("maxOutput 被 clamp 在可用区间内", () => {
		expect(normalizeSnapshot({ maxOutput: 1 }).maxOutput).toBe(2000);
		expect(normalizeSnapshot({ maxOutput: 9_000_000 }).maxOutput).toBe(500000);
		expect(normalizeSnapshot({ maxOutput: "big" }).maxOutput).toBe(20000);
	});
});

describe("materializeAgentBrowserConfig", () => {
	it("托管模式写 profile，且不写 autoConnect", () => {
		const { config } = materializeAgentBrowserConfig({ snapshot: { browserSource: "managed" }, ...paths });
		expect(config.profile).toBe(paths.profileDir);
		expect(config.autoConnect).toBeUndefined();
	});

	it("附着模式写 autoConnect，且**绝不**同时写 profile —— 上游视为互斥", () => {
		const { config } = materializeAgentBrowserConfig({ snapshot: { browserSource: "attach" }, ...paths });
		expect(config.autoConnect).toBe(true);
		expect(config.profile).toBeUndefined();
	});

	it("始终开启内容边界与 tab 钉住", () => {
		const { config } = materializeAgentBrowserConfig({ snapshot: {}, ...paths });
		expect(config.contentBoundaries).toBe(true);
		expect(config.pinTab).toBe(true);
	});

	it("action-policy 按开关生成拒绝类别，路径指向传入的文件", () => {
		const { config, actionPolicy } = materializeAgentBrowserConfig({
			snapshot: { denyEval: true, denyDownload: true, denyUpload: false },
			...paths,
		});
		expect(config.actionPolicy).toBe(paths.actionPolicyPath);
		expect(actionPolicy).toEqual({ default: "allow", deny: ["eval", "download"] });
	});

	it("全部放开时 deny 为空数组而不是缺省 —— 配置形状要稳定", () => {
		const { actionPolicy } = materializeAgentBrowserConfig({
			snapshot: { denyEval: false, denyDownload: false, denyUpload: false },
			...paths,
		});
		expect(actionPolicy.deny).toEqual([]);
	});
});

describe("buildMcpArgv", () => {
	it("全局开关在子命令之前，--tools 在 mcp 之后", () => {
		const argv = buildMcpArgv({ configPath: "/c.json", sessionId: "vetta-a", toolsProfile: "core" });
		expect(argv).toEqual(["--config", "/c.json", "--session", "vetta-a", "--pin-tab", "mcp", "--tools", "core"]);
	});

	it("空 profile 回落 core，避免启动失败导致整个工具面消失", () => {
		const argv = buildMcpArgv({ configPath: "/c.json", sessionId: "s", toolsProfile: "   " });
		expect(argv.at(-1)).toBe("core");
	});

	it("session id 带 Vetta 前缀，便于与用户自己在终端开的会话区分", () => {
		expect(buildSessionId(() => 0.5).startsWith(SESSION_PREFIX)).toBe(true);
	});
});

describe("resolveAgentBrowserBinary", () => {
	it("Unix 上取 PATH 目录里的同名可执行文件", () => {
		const found = resolveAgentBrowserBinary({
			pathValue: "/a/bin:/b/bin",
			platform: "darwin",
			arch: "arm64",
			exists: (p: string) => p === "/b/bin/agent-browser",
		});
		expect(found).toBe("/b/bin/agent-browser");
	});

	it("Windows 上直接定位包内原生 exe，而不是 npm 的 .cmd shim", () => {
		const found = resolveAgentBrowserBinary({
			pathValue: "C:\\np",
			platform: "win32",
			arch: "x64",
			exists: (p: string) => p.endsWith("agent-browser-win32-x64.exe"),
		});
		expect(found).toContain("agent-browser-win32-x64.exe");
	});

	it("Windows ARM64 回落到 x64 二进制（上游没有原生 ARM 构建）", () => {
		expect(binaryFileName("win32", "arm64")).toBe("agent-browser-win32-x64.exe");
	});

	it("找不到时返回 null，由调用方降级到 stub server", () => {
		expect(
			resolveAgentBrowserBinary({ pathValue: "/a", platform: "linux", arch: "x64", exists: () => false }),
		).toBeNull();
	});

	it("PATH 为空不会崩", () => {
		expect(resolveAgentBrowserBinary({ pathValue: "", platform: "linux", arch: "x64", exists: () => true })).toBeNull();
	});
});
