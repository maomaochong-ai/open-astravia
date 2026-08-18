// @vitest-environment jsdom
import type { Project, SessionInfo } from "@shared/store/atoms";
import { render } from "@testing-library/react";
import type { JSX, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 只关心 section 往会话列表交出的 cwd，其余视图与筛选器都替换成最小替身。
vi.mock("@vetta/theme-ui/project", () => ({
	DefaultConversationSectionView: ({ list }: { list: ReactNode }): JSX.Element => <div>{list}</div>,
}));
vi.mock("../../filters/SidebarFilterSelect", () => ({
	DefaultConversationFilterSelect: (): JSX.Element => <div />,
}));

const listProps = vi.fn();
vi.mock("./DefaultSessionList", () => ({
	DefaultSessionList: (props: { cwd: string }): JSX.Element => {
		listProps(props);
		return <div data-testid="session-list" data-cwd={props.cwd} />;
	},
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key, i18n: { language: "zh" } }),
}));

const { DefaultConversationSection } = await import("./DefaultConversationSection.js");

const DEFAULT_PROJECT: Project = {
	cwd: "/home/user/.vetta/desktop-app/conversation",
	name: "对话",
	isDefault: true,
} as Project;

const IM_CWD = "/home/user/.vetta/im-gateway/conversation";

const CLAW_SESSION: SessionInfo = {
	id: "claw-1",
	path: `${IM_CWD}/2026-08-14/a.jsonl`,
	cwd: IM_CWD,
	firstMessage: "微信来的消息",
	modifiedAt: 1,
	access: { readHistory: true, interactiveResume: false, rename: true, delete: true },
};

function renderSection(sessionsCwd: string, filter: "conversation" | "claw"): void {
	render(
		<DefaultConversationSection
			activeSessionPath=""
			defaultConversationFilter={filter}
			onBeforeSelectSession={() => {}}
			onNewSession={() => {}}
			onRenameSession={() => {}}
			onSelectSession={() => {}}
			project={DEFAULT_PROJECT}
			sessions={[CLAW_SESSION]}
			sessionsCwd={sessionsCwd}
			sessionsLoading={false}
		/>,
	);
}

describe("DefaultConversationSection", () => {
	beforeEach(() => listProps.mockClear());

	it("claw 过滤下把 im-gateway 的 cwd 交给会话列表", () => {
		// 回归点：这里若回落成 project.cwd，点击 Claw 会话时按错的 cwd 查不到
		// session.access，判定会退化为交互式恢复，主进程抛 SESSION_READ_ONLY，
		// 只读视图永远打不开。
		renderSection(IM_CWD, "claw");
		expect(listProps).toHaveBeenCalledWith(expect.objectContaining({ cwd: IM_CWD }));
	});

	it("普通对话过滤下仍用默认项目的 cwd", () => {
		renderSection(DEFAULT_PROJECT.cwd, "conversation");
		expect(listProps).toHaveBeenCalledWith(expect.objectContaining({ cwd: DEFAULT_PROJECT.cwd }));
	});

	it("sessionsCwd 缺失时回落到 project.cwd", () => {
		renderSection("", "conversation");
		expect(listProps).toHaveBeenCalledWith(expect.objectContaining({ cwd: DEFAULT_PROJECT.cwd }));
	});
});
