// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { QueueCardView } from "@vetta/theme-ui/chat";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { CommandPanelView } from "./CommandPanelView";

class ResizeObserverStub {
	observe(): void {}
	disconnect(): void {}
}

vi.stubGlobal("ResizeObserver", ResizeObserverStub);

describe("CommandPanelView built-in operation", () => {
	it("在列表顶部渲染可访问的压缩操作和真实占比圆环", () => {
		const onSelect = vi.fn();
		const { container } = render(
			<CommandPanelView
				open
				filter=""
				items={[]}
				activeIndex={0}
				operation={{
					id: "compact",
					label: "压缩上下文",
					description: "压缩此聊天的上下文（已使用 60%）",
					contextRing: {
						percent: 60,
						offset: 16,
						color: "var(--primary)",
						isCompacting: false,
						tooltip: "60%",
					},
					disabled: false,
					onSelect,
				}}
				connectors={[]}
				connectorColumns={4}
				actions={[]}
				labels={{
					header: "命令",
					resultCount: "0 个结果",
					connectorsSection: "已接入",
					emptyNoMatch: "无结果",
					emptyNoMatchHint: "",
					emptyNoSkills: "无技能",
					emptyNoSkillsHint: "",
				}}
				resolveIcon={() => undefined}
				panelRef={createRef<HTMLDivElement>()}
				onHoverItem={vi.fn()}
				onSelectItem={vi.fn()}
				onSelectConnector={vi.fn()}
			/>,
		);

		const button = screen.getByRole("button", { name: /压缩上下文/ });
		expect(container.querySelector("svg")).not.toBeNull();
		fireEvent.click(button);
		expect(onSelect).toHaveBeenCalledOnce();
	});

	it("压缩队列项保留删除与拖动入口，但不提供会中立即发送", () => {
		const onSendNow = vi.fn();
		const onRemove = vi.fn();
		render(
			<QueueCardView
				items={[{ id: "compact-1", kind: "context_compaction", displayText: "压缩上下文" }]}
				labels={{ empty: "空", sendNow: "立即发送", delete: "删除" }}
				onReorder={vi.fn()}
				onSendNow={onSendNow}
				onRemove={onRemove}
			/>,
		);

		expect(screen.queryByTitle("立即发送")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "删除" }));
		expect(onRemove).toHaveBeenCalledWith("compact-1");
		expect(onSendNow).not.toHaveBeenCalled();
	});

	it("压缩屏障后的消息不提供立即发送，屏障前的消息仍可发送", () => {
		const onSendNow = vi.fn();
		render(
			<QueueCardView
				items={[
					{ id: "before", kind: "message", displayText: "屏障前", canSendNow: true },
					{ id: "compact", kind: "context_compaction", displayText: "压缩上下文", canSendNow: false },
					{ id: "after", kind: "message", displayText: "屏障后", canSendNow: false },
				]}
				labels={{ empty: "空", sendNow: "立即发送", delete: "删除" }}
				onReorder={vi.fn()}
				onSendNow={onSendNow}
				onRemove={vi.fn()}
			/>,
		);

		expect(screen.getByText("屏障后").closest("button")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "屏障前" }));
		expect(onSendNow).toHaveBeenCalledWith("before");
	});
});
