import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CompactionStepView } from "./CompactionStepView";

describe("CompactionStepView", () => {
	it("shows the summary that replaced earlier context once opened", () => {
		const closed = renderToStaticMarkup(
			<CompactionStepView status="success" label="Context compacted" detail="120k tokens before" summary="earlier work" />,
		);
		expect(closed).toContain("Context compacted");
		expect(closed).toContain("120k tokens before");
		expect(closed).toContain('aria-expanded="false"');
		expect(closed).not.toContain("earlier work");

		const open = renderToStaticMarkup(
			<CompactionStepView status="success" label="Context compacted" summary="earlier work" expanded />,
		);
		expect(open).toContain('aria-expanded="true"');
		expect(open).toContain("earlier work");
	});

	it("opens the panel while running even before the first summary delta arrives", () => {
		// 压缩实测可能跑好几分钟、首段 delta 到达前没有任何文本；这段时间必须能展开看进度。
		const markup = renderToStaticMarkup(
			<CompactionStepView
				status="running"
				label="Compacting context…"
				pendingHint={<span data-testid="pending">Generating summary…</span>}
			/>,
		);
		expect(markup).toContain('data-compaction-step="running"');
		expect(markup).not.toContain("disabled");
		expect(markup).toContain('aria-expanded="true"');
		expect(markup).toContain("Generating summary…");
		expect(markup).toContain("tool-call-shimmer-text");
	});

	it("stays collapsed and inert when there is nothing to show", () => {
		const markup = renderToStaticMarkup(<CompactionStepView status="success" label="Context compacted" />);
		expect(markup).toContain("disabled");
		expect(markup).not.toContain("compaction-summary");
	});

	it("auto-expands summary panel while streaming so user can follow in real time", () => {
		const markup = renderToStaticMarkup(
			<CompactionStepView status="running" label="Compacting context…" summary="Partial summary so far…" />,
		);
		expect(markup).toContain('data-compaction-step="running"');
		expect(markup).not.toContain("disabled");
		expect(markup).toContain('aria-expanded="true"');
		expect(markup).toContain("Partial summary so far…");
		expect(markup).toContain("tool-call-shimmer-text");
	});

	it("keeps a failed compaction visibly distinct", () => {
		const markup = renderToStaticMarkup(<CompactionStepView status="error" label="Context compaction failed" />);
		expect(markup).toContain("icon-[solar--danger-circle-linear]");
		expect(markup).toContain("text-destructive/80");
	});

	it("renders the summary through the host-supplied renderer when given one", () => {
		// 摘要是模型写的叙述，宿主注入的渲染器负责把它变成 Markdown 预览；
		// 注入时不能再退化成 whitespace-pre-wrap 的原文墙。
		const markup = renderToStaticMarkup(
			<CompactionStepView
				status="success"
				label="Context compacted"
				summary="**bold** summary"
				expanded
				renderSummary={(summary) => <strong data-testid="rendered-summary">{summary.toUpperCase()}</strong>}
			/>,
		);
		expect(markup).toContain("**BOLD** SUMMARY");
		expect(markup).not.toContain("whitespace-pre-wrap");
	});

	it("marks the summary panel so the host can rescale it to the panel rhythm", () => {
		// 摘要里的 Markdown 元素各自带绝对 text-[Npx]（特异性 0,1,0），父级字号进不去；
		// 所以宿主要靠这两个类名挂容器查询与 0,1,1 的后代字号规则。
		const markup = renderToStaticMarkup(
			<CompactionStepView
				status="success"
				label="Context compacted"
				summary="## earlier work"
				expanded
				renderSummary={(summary) => <div>{summary}</div>}
			/>,
		);
		expect(markup).toContain("compaction-step");
		expect(markup).toContain("compaction-summary");
		expect(markup).not.toContain("text-[12px]");
	});

	it("tells the host whether the summary is still growing", () => {
		// 增长中的正文必须走宿主的流式管线；宿主拿不到这个信号，就只能每次增量把整篇重解析一遍。
		const seen: boolean[] = [];
		const renderSummary = (summary: string, streaming: boolean) => {
			seen.push(streaming);
			return <div>{summary}</div>;
		};

		renderToStaticMarkup(
			<CompactionStepView status="running" label="Compacting context…" summary="partial" renderSummary={renderSummary} />,
		);
		renderToStaticMarkup(
			<CompactionStepView
				status="success"
				label="Context compacted"
				summary="settled"
				expanded
				renderSummary={renderSummary}
			/>,
		);
		// 导出拿的是静态快照，流式渲染只会给出已放出的那一段，所以导出时不算增长。
		renderToStaticMarkup(
			<CompactionStepView
				status="running"
				label="Compacting context…"
				summary="partial"
				exportMode
				renderSummary={renderSummary}
			/>,
		);

		expect(seen).toEqual([true, false, false]);
	});
});
