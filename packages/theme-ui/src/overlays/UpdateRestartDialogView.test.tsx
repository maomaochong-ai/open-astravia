import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UpdateRestartDialogView } from "./UpdateRestartDialogView";

// electron-updater 的 GitHub provider 取的是 Atom feed 里已经渲染过的 HTML。
const FEED_HTML = "<h2>新增</h2><ul><li><strong>内置浏览器</strong>可以从标签页菜单添加了</li></ul>";

function renderDialog(releaseNote: string): string {
	return renderToStaticMarkup(
		<UpdateRestartDialogView
			bannerSrc={undefined}
			closeLabel="关闭"
			onClose={() => {}}
			overlayRef={createRef<HTMLDivElement>()}
			releaseNote={releaseNote}
			title="Astravia 0.5.94 版本介绍"
			visible
		/>,
	);
}

/**
 * 断言按下标点在渲染结果里出现，而不是匹配裸标签：Markdown 渲染器会给标题、列表项
 * 挂上排版类名，写死 `<h2>新增</h2>` 会在任何一次排版调整后误报——它该锁的是
 * 「HTML 被当成 HTML 渲染、没有被转义成文本」，不是具体属性。
 */
describe("UpdateRestartDialogView", () => {
	it("把 feed 里的 HTML 当 HTML 渲染，而不是把标签打成文本", () => {
		const html = renderDialog(FEED_HTML);

		expect(html).toMatch(/<h2[^>]*>新增<\/h2>/);
		expect(html).toMatch(/<strong[^>]*>内置浏览器<\/strong>/);
		expect(html).not.toContain("&lt;h2&gt;");
		expect(html).not.toContain("&lt;ul&gt;");
	});

	it("Markdown 文本被渲染成结构，而不是原样输出", () => {
		const html = renderDialog("## 新增\n\n- **内置浏览器**可以从标签页菜单添加了");

		expect(html).toMatch(/<h2[^>]*>新增<\/h2>/);
		expect(html).toMatch(/<strong[^>]*>内置浏览器<\/strong>/);
		expect(html).toMatch(/<li[^>]*>/);
	});

	// 回归：对话框里的说明按卡片高度裁切，长版本到此为止；没有这条入口，
	// 用户只能读到前面几条，与设置页卡片的行为也对不上。
	it("给出 onViewMore 时渲染「查看更多」入口", () => {
		const withMore = renderToStaticMarkup(
			<UpdateRestartDialogView
				bannerSrc={undefined}
				closeLabel="关闭"
				onClose={() => {}}
				onViewMore={() => {}}
				overlayRef={createRef<HTMLDivElement>()}
				releaseNote="## 新增\n\n- 一条改动"
				title="发现新版本"
				viewMoreLabel="查看更多"
				visible
			/>,
		);
		expect(withMore).toContain("查看更多");

		const withoutMore = renderToStaticMarkup(
			<UpdateRestartDialogView
				bannerSrc={undefined}
				closeLabel="关闭"
				onClose={() => {}}
				overlayRef={createRef<HTMLDivElement>()}
				releaseNote="## 新增\n\n- 一条改动"
				title="发现新版本"
				visible
			/>,
		);
		expect(withoutMore).not.toContain("查看更多");
	});

	it("没有正文时显示占位文案", () => {
		const html = renderToStaticMarkup(
			<UpdateRestartDialogView
				bannerSrc={undefined}
				closeLabel="关闭"
				emptyText="暂无这个版本的介绍。"
				onClose={() => {}}
				overlayRef={createRef<HTMLDivElement>()}
				title="Astravia 0.5.94 版本介绍"
				visible
			/>,
		);

		expect(html).toContain("暂无这个版本的介绍。");
	});

	it("有底部动作时才渲染底栏按钮", () => {
		const withAction = renderToStaticMarkup(
			<UpdateRestartDialogView
				bannerSrc={undefined}
				closeLabel="关闭"
				onClose={() => {}}
				overlayRef={createRef<HTMLDivElement>()}
				primary={{ label: "立即更新", onClick: () => {} }}
				title="发现新版本"
				visible
			/>,
		);
		expect(withAction).toContain("立即更新");

		const withoutAction = renderDialog("## 新增");
		expect(withoutAction).not.toContain("立即更新");
	});
});
