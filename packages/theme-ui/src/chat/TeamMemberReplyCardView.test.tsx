import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TeamMemberReplyCardView } from "./TeamMemberReplyCardView";

const props = {
	memberName: "研究员",
	state: "streaming" as const,
	statusLabel: "正在思考",
	durationLabel: "42秒",
	activity: "正在检查配置和边界条件",
	recentLabel: "最近：读取项目配置",
	openLabel: "打开 研究员 的成员会话",
};

describe("TeamMemberReplyCardView", () => {
	it("starts collapsed to the identity and status line", () => {
		const markup = renderToStaticMarkup(<TeamMemberReplyCardView {...props} onOpen={() => undefined} />);

		expect(markup).toContain("研究员");
		expect(markup).toContain("正在思考");
		expect(markup).toContain("42秒");
		expect(markup).toContain('aria-expanded="false"');
		expect(markup).not.toContain("正在检查配置和边界条件");
		expect(markup).not.toContain("最近：读取项目配置");
		expect(markup).toContain('aria-label="打开 研究员 的成员会话"');
	});

	it("has no open button when the member's conversation cannot be opened", () => {
		const markup = renderToStaticMarkup(<TeamMemberReplyCardView {...props} />);

		expect(markup).not.toContain('aria-label="打开 研究员 的成员会话"');
	});
});
