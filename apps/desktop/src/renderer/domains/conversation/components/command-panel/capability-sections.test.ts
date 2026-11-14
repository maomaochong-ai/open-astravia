import { describe, expect, it, vi } from "vitest";
import { CAPABILITY_SECTION_ORDER, resolveCapabilitySections, sectionAppliesFilter } from "./capability-sections";

const file = { id: "addFile" as const, label: "添加文件", onSelect: vi.fn() };
const skill = { name: "s1" } as never;
const connector = { id: "c1" } as never;

/**
 * ADR-0156：面板按类型分区，顺序固定；空区段不渲染。
 * 这两条一起保证「同一类条目永远在同一位置」与「不出现空标题」。
 */
describe("添加面板的能力区段", () => {
	it("顺序固定为 文件 → 技能 → 连接器 → 插件 → 应用", () => {
		expect(CAPABILITY_SECTION_ORDER).toEqual(["files", "skills", "connectors", "plugins", "apps"]);
	});

	it("只有有内容的区段才出现", () => {
		const sections = resolveCapabilitySections({ files: [file], skills: [skill], plugins: [] });
		expect(sections.map((s) => s.kind)).toEqual(["files", "skills"]);
		expect(sections.map((s) => s.itemCount)).toEqual([1, 1]);
	});

	it("全空时返回空数组（不渲染空面板）", () => {
		expect(resolveCapabilitySections({})).toEqual([]);
	});

	it("文件区段不参与过滤：它是直接动作，不是可搜索条目", () => {
		const [files] = resolveCapabilitySections({ files: [file], connectors: [connector] });
		expect(files?.searchable).toBe(false);
		expect(sectionAppliesFilter(files!)).toBe(false);
	});

	it("连接器区段参与过滤", () => {
		const sections = resolveCapabilitySections({ connectors: [connector] });
		expect(sections[0]?.searchable).toBe(true);
		expect(sectionAppliesFilter(sections[0]!)).toBe(true);
	});

	it("每类都有自己的标题键，不共用", () => {
		const sections = resolveCapabilitySections({
			files: [file],
			skills: [skill],
			connectors: [connector],
			plugins: [{ id: "p1", label: "插件" }],
			apps: [{ id: "a1", label: "应用" }],
		});
		const keys = sections.map((s) => s.titleKey);
		expect(new Set(keys).size).toBe(keys.length);
	});
});
