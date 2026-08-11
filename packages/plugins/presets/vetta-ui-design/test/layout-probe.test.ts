/**
 * 渲染态机检。
 *
 * 两半分开测：探针脚本要在真 DOM 上跑得通（happy-dom 没有排版引擎，所以只验它不抛、
 * 结构对），转换那半是纯函数，误报面全在它这里——「不属于这一帧的发现不能混进来」
 * 和「量到了就要报」一样重要，理由同 check-sources：让 agent 拿着别处的报错改当前
 * 文件，比不报更糟。
 */
import { expect, it } from "vitest";
import { LAYOUT_PROBE_SCRIPT, layoutIssues } from "../src/vetd/layout-probe";

const finding = (over: Partial<Record<string, unknown>> = {}) => ({
	rule: "icon-missing",
	source: "frames/login.tsx:42",
	detail: "icon-[lucide--search]",
	text: "",
	...over,
});

it("keeps the source location so the agent can edit the right line", () => {
	const [issue] = layoutIssues([finding()], "login");
	expect(issue.file).toBe("frames/login.tsx");
	expect(issue.line).toBe(42);
	expect(issue.rule).toBe("icon-missing");
	expect(issue.message).toContain("icon-[lucide--search]");
});

it("drops findings that belong to another file", () => {
	// _layout.tsx 和 components/ 与画框在同一棵 DOM 上，但报给这一帧就是误导。
	const issues = layoutIssues(
		[finding({ source: "frames/_layout.tsx:8" }), finding({ source: "components/Card.tsx:3" }), finding()],
		"login",
	);
	expect(issues).toHaveLength(1);
	expect(issues[0].file).toBe("frames/login.tsx");
});

it("keeps a finding that could not be traced back to a line", () => {
	// 定位不到总比丢掉好：agent 至少知道这一帧有这个毛病。
	const [issue] = layoutIssues([finding({ source: null })], "login");
	expect(issue.file).toBe("frames/login.tsx");
	expect(issue.line).toBeNull();
});

it("ignores anything that is not a well-formed finding", () => {
	expect(layoutIssues(undefined, "login")).toEqual([]);
	expect(layoutIssues("boom", "login")).toEqual([]);
	expect(layoutIssues([{ rule: "icon-missing" }], "login")).toEqual([]);
	// 探针版本比宿主新时会冒出没见过的规则名，静默丢掉而不是报一条没有文案的 issue。
	expect(layoutIssues([finding({ rule: "invented-later" })], "login")).toEqual([]);
});

it("explains each rule in terms of what was measured and what to change", () => {
	const rules = ["icon-missing", "bg-token-undefined", "text-clipped", "unintended-wrap", "edge-misaligned"];
	for (const rule of rules) {
		const [issue] = layoutIssues([finding({ rule, detail: rule === "bg-token-undefined" ? "bg-surface" : "x" })], "login");
		expect(issue, rule).toBeDefined();
		expect(issue.message.length, rule).toBeGreaterThan(40);
	}
});

it("runs against a real DOM without throwing and returns findings", () => {
	document.body.innerHTML = `
		<div data-vetd-source="frames/login.tsx:3">
			<span class="icon-[lucide--search] size-4" data-vetd-source="frames/login.tsx:7"></span>
			<button data-vetd-source="frames/login.tsx:9">保存草稿</button>
		</div>`;
	const result: unknown = eval(LAYOUT_PROBE_SCRIPT);
	expect(Array.isArray(result)).toBe(true);
	// happy-dom 不排版，量不出换行/裁切；但没有 mask-image 的图标位是判得出来的。
	const rules = (result as { rule: string }[]).map((item) => item.rule);
	expect(rules).toContain("icon-missing");
});
