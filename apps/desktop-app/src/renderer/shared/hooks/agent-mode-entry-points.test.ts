/**
 * 工作模式的调整入口只保留新会话页一处：侧边栏徽章、设置菜单区块、共享分段切换器都已删除。
 * 这是一条结构约束（会被「顺手加回一个入口」悄悄破坏），且删除后不能留下悬空引用，
 * 因此用源码断言守住，而不是渲染每一个宿主组件。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const rendererRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const REMOVED_ENTRY_POINTS = [
	"shared/components/AgentModeSwitcher.tsx",
	"domains/project/components/sidebar/AgentModeBadgeDropdown.tsx",
	"domains/project/components/sidebar/settings-menu/SettingsMenuAgentModeSection.tsx",
];

const HOSTS_WITHOUT_MODE_ENTRY = [
	"domains/project/components/sidebar/SidebarTopBar.tsx",
	"domains/project/components/sidebar/settings-menu/SettingsMenuPopover.tsx",
];

it.each(REMOVED_ENTRY_POINTS)("%s is gone", (relative) => {
	expect(existsSync(join(rendererRoot, relative))).toBe(false);
});

it.each(HOSTS_WITHOUT_MODE_ENTRY)("%s renders no agent-mode entry", (relative) => {
	const source = readFileSync(join(rendererRoot, relative), "utf8");
	expect(source).not.toMatch(/AgentMode/);
});

it("keeps the new-session toggle as the only consumer of the default-mode hook", () => {
	const toggle = readFileSync(
		join(rendererRoot, "domains/chat/components/new-session/AgentModeIconToggle.tsx"),
		"utf8",
	);
	expect(toggle).toContain("useDefaultAgentMode");
	// 旧 hook 文件名/导出必须彻底消失，否则会留下第二条读写模式的路径。
	expect(existsSync(join(rendererRoot, "shared/hooks/useAgentMode.ts"))).toBe(false);
});
