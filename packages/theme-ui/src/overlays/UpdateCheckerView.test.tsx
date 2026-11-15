import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UpdateCheckerDetail, type UpdateCheckerViewLabels } from "./UpdateCheckerView";
// 从 barrel 取归一化函数：desktop 侧读的是同一入口，这条引用保证导出没被删改。
import { normalizeReleaseNote } from "./index";

const labels: UpdateCheckerViewLabels = {
	check: "Check for updates",
	checking: "Checking",
	checkingBtn: "Checking",
	currentVersion: (version) => `Current ${version}`,
	download: "Download",
	downloading: (progress) => `Downloading ${progress}%`,
	idle: (version) => `Up to date (${version})`,
	newVersion: (version) => `Version ${version}`,
	restart: "Restart",
	viewMore: "View more",
};

// electron-updater 的 GitHub provider 取的是 Atom feed 里已经渲染过的 HTML。
const FEED_HTML =
	"<h2>新增</h2><ul><li><strong>内置浏览器可以从标签页菜单添加了</strong>：现在它按普通面板参与可见性解析。</li></ul>";

const notesMarkdown = "## 新增\n\n- **内置浏览器可以从标签页菜单添加了**：现在它按普通面板参与可见性解析。";

// 两节各一条与两条，用来验证序号按小节重排，而不是整篇连续编号。
const SECTIONED_NOTE = "## 新增\n\n- **甲**：一。\n- **乙**：二。\n\n## 修复\n\n- **丙**：三。";

function renderDetail(releaseNote: string): string {
	return renderToStaticMarkup(
		<UpdateCheckerDetail
			currentVersion="0.5.73"
			labels={labels}
			latestVersion="0.5.77"
			onPrimary={() => {}}
			onViewMore={() => {}}
			phase="available"
			releaseNote={releaseNote}
		/>,
	);
}

describe("UpdateCheckerDetail", () => {
	it("renders the release note html as structured text instead of showing the tags", () => {
		const html = renderDetail(FEED_HTML);

		expect(html).toContain(">新增<");
		expect(html).toContain("内置浏览器可以从标签页菜单添加了");
		// 每条只显摘要（粗体标题），冒号后的细节正文不再进入卡片。
		expect(html).not.toContain("现在它按普通面板参与可见性解析。");
		expect(html).not.toContain("&lt;h2&gt;");
		expect(html).not.toContain("&lt;ul&gt;");
	});

	it("renders the markdown release notes the same way", () => {
		const html = renderDetail(notesMarkdown);

		expect(html).toContain(">新增<");
		expect(html).toContain("内置浏览器可以从标签页菜单添加了");
		expect(html).not.toContain("**内置浏览器");
		expect(html).not.toContain("## ");
	});

	it("每条变更只显摘要标题，不把冒号后的细节正文铺出来", () => {
		const html = renderDetail(FEED_HTML);

		// 摘要（粗体标题）是单独一行；细节正文不再渲染成第二段。
		expect(html).toMatch(/font-medium[^"]*">内置浏览器可以从标签页菜单添加了<\/div>/u);
		expect(html).not.toContain("现在它按普通面板参与可见性解析。");
	});

	it("numbers the items and restarts the numbering for every section", () => {
		const html = renderDetail(SECTIONED_NOTE);

		expect(html.match(/>1<\/span>/gu)).toHaveLength(2);
		expect(html.match(/>2<\/span>/gu)).toHaveLength(1);
		expect(html).not.toContain(">3</span>");
	});

	it("keeps the note inside its own scroll box so it cannot cover the rows below", () => {
		const html = renderDetail(FEED_HTML);

		expect(html).toContain("max-height:240px");
		expect(html).toContain("overflow-y:auto");
		expect(html).toContain("overflow-x:hidden");
		// 滚动容器必须落在 style 上。`.markdown-body` 在 styles.css 里以非分层规则写了
		// `overflow: visible`，它胜过 Tailwind 分层工具类的 `overflow-hidden`；只靠工具类时
		// 长说明会溢出 240px 的盒子、盖住下面的「启动 App 引导」行（0.5.78 实机现形）。
		// 用 auto 而非 hidden：说明再长也停在盒子里自己滚，读得完又盖不住下面。
		expect(html).toContain("border-radius:8px;overflow:hidden");
	});

	it("exports the release-note normaliser through the package barrel", () => {
		expect(normalizeReleaseNote(FEED_HTML)).toBe(notesMarkdown);
	});
});
