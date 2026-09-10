// @vitest-environment jsdom

import type { AgentProfile } from "@vetta/agent-team";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AgentConstellation } from "./AgentConstellation";

function agent(id: string): AgentProfile {
	return {
		id,
		revision: 1,
		name: id,
		description: "",
		mentionHandle: id,
		blueprintId: "builder",
		abilities: { skills: [], mcpServers: [], plugins: [] },
		scope: { kind: "library" },
		createdAt: 1,
		updatedAt: 1,
	};
}

function agents(count: number): readonly AgentProfile[] {
	return Array.from({ length: count }, (_, index) => agent(`a${index}`));
}

describe("AgentConstellation", () => {
	it("没有智能体时不渲染任何装饰", () => {
		const { container } = render(<AgentConstellation agents={[]} />);
		expect(container.innerHTML).toBe("");
	});

	it("单枚头像不画弧线，也不抬高", () => {
		const { container } = render(<AgentConstellation agents={agents(1)} />);
		expect(container.querySelector("svg")).toBeNull();
		const avatar = container.querySelector<HTMLElement>("[style*='left']");
		expect(avatar?.style.left).toBe("0px");
		expect(avatar?.style.top).toBe("9px");
	});

	it("多枚头像沿弧线排开，中间的比两端高", () => {
		const { container } = render(<AgentConstellation agents={agents(3)} />);
		const tops = Array.from(container.querySelectorAll<HTMLElement>("[style*='top']")).map((node) =>
			Number.parseFloat(node.style.top),
		);
		expect(tops).toHaveLength(3);
		expect(tops[1]).toBeLessThan(tops[0]);
		expect(tops[1]).toBeLessThan(tops[2]);
		expect(container.querySelector("svg")).not.toBeNull();
	});

	it("超过 5 位时只挂 5 枚头像，末尾补一枚计数片", () => {
		const { container, getByText } = render(<AgentConstellation agents={agents(9)} />);
		expect(container.querySelectorAll("img")).toHaveLength(5);
		expect(container.querySelectorAll("[style*='left']")).toHaveLength(6);
		expect(getByText("+4")).toBeTruthy();
	});
});
