// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createAgentTeamFixture } from "@vetta/agent-team";
import { createElement, type ReactNode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAgentTeamDirectoryForTest } from "./agent-team-directory";
import { NewSessionAgentSelector } from "./NewSessionAgentSelector";
import { DefaultNewSessionHero } from "./NewSessionHero";
import type { NewSessionTargetKey } from "./target";
import { useNewSessionTargetIdentity } from "./useNewSessionTargetIdentity";

// hero 与选择器里的头像都挂着 motion；这里只关心 DOM 结构，动画一律退化成普通元素。
vi.mock("motion/react", () => ({
	AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
	motion: new Proxy(
		{},
		{
			get:
				(_target, tag: string) =>
				({ children, ...rest }: { children?: ReactNode }) =>
					createElement(tag, domProps(rest), children),
		},
	),
	useAnimation: () => ({ set: () => {}, start: async () => {}, stop: () => {} }),
	useReducedMotion: () => true,
}));

/** motion 专属 props 不能透传给 DOM，否则 React 会对每个未知属性告警。 */
function domProps(props: Record<string, unknown>): Record<string, unknown> {
	const motionOnly = new Set(["animate", "exit", "initial", "transition", "variants", "whileHover", "whileTap"]);
	return Object.fromEntries(Object.entries(props).filter(([key]) => !motionOnly.has(key)));
}
vi.mock("../GuideBadgeSwiper", () => ({ GuideBadgeSwiper: () => null }));
vi.mock("./NewSessionMascot", () => ({ NewSessionMascot: () => null }));
vi.mock("@vetta/theme-sdk", () => ({ useThemeComponent: (_key: string, fallback: unknown) => fallback }));
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, values?: Record<string, number>) =>
			key === "newSession.agentSelector.memberCount" ? `${values?.count ?? 0} members` : key,
	}),
}));

afterEach(cleanup);

/** 新会话页的真实接线：选择器改 target，hero 通过同一份名录解析出身份。 */
function Harness(): JSX.Element {
	const [targetKey, setTargetKey] = useState<NewSessionTargetKey | null>(null);
	const identity = useNewSessionTargetIdentity(targetKey);
	return (
		<>
			<NewSessionAgentSelector selectedKey={targetKey} onSelect={setTargetKey} />
			<DefaultNewSessionHero
				avatarAutoplay={false}
				greetingTitle="Hi, Ada"
				identity={identity}
				mounted
				onSceneClick={() => {}}
				sceneActions={{}}
				sceneLabels={{ installPrompt: "", next: "", previous: "" }}
				scenes={[]}
				selected={null}
				subtitle="今天想做点什么"
			/>
		</>
	);
}

describe("new session hero identity", () => {
	const document = createAgentTeamFixture();
	const team = document.teams[0];
	const agent = document.agents.find((candidate) => candidate.name === "Auditor");
	if (!team || !agent) throw new Error("missing Agent Team fixture");

	beforeEach(() => {
		resetAgentTeamDirectoryForTest();
		Object.defineProperty(window, "vetta", {
			configurable: true,
			value: { agentTeams: { list: vi.fn(async () => document) } },
		});
	});

	async function pick(name: string): Promise<void> {
		const user = userEvent.setup();
		await user.click(screen.getAllByRole("button")[0]!);
		await user.click(await screen.findByRole("option", { name: new RegExp(name) }));
	}

	it("greets the user until a target is picked", () => {
		render(<Harness />);

		expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Hi, Ada");
		expect(screen.getByText("今天想做点什么")).toBeDefined();
	});

	it("shows the picked agent's name, description and avatar in place of the greeting", async () => {
		render(<Harness />);

		await pick(agent.name);

		expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(agent.name);
		expect(screen.getByText(agent.description)).toBeDefined();
		expect(window.document.querySelectorAll(".ns-hero-avatar-slot img")).toHaveLength(1);
	});

	it("shows the team's avatar group and swaps identities when the pick changes", async () => {
		render(<Harness />);

		await pick(agent.name);
		await pick(team.name);

		expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(team.name);
		expect(window.document.querySelectorAll(".ns-hero-avatar-slot img").length).toBe(
			Math.min(3, team.members.length),
		);
	});

	it("folds a team larger than the avatar row into a trailing +n", async () => {
		expect(team.members.length).toBeGreaterThan(3);
		render(<Harness />);

		await pick(team.name);

		const slot = window.document.querySelector(".ns-hero-avatar-slot");
		expect(slot?.querySelectorAll("img")).toHaveLength(3);
		// 选择器 chip 里也有一枚 “+n”，这里只认 hero 槽内的那一枚。
		expect(slot?.querySelector("[data-avatar-overflow]")?.textContent).toBe(`+${team.members.length - 3}`);
	});

	it("leaves the avatar row alone when the team fits", async () => {
		const smallTeam = { ...team, members: team.members.slice(0, 2) };
		Object.defineProperty(window, "vetta", {
			configurable: true,
			value: { agentTeams: { list: vi.fn(async () => ({ ...document, teams: [smallTeam] })) } },
		});
		render(<Harness />);

		await pick(team.name);

		const slot = window.document.querySelector(".ns-hero-avatar-slot");
		expect(slot?.querySelectorAll("img")).toHaveLength(2);
		expect(slot?.querySelector("[data-avatar-overflow]")).toBeNull();
	});

	it("keeps the avatars mounted while the slot collapses back to the greeting", async () => {
		render(<Harness />);

		await pick(agent.name);
		const user = userEvent.setup();
		await user.click(screen.getAllByRole("button")[0]!);
		await user.click(await screen.findByText("newSession.agentSelector.clear"));

		expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Hi, Ada");
		const slot = window.document.querySelector(".ns-hero-avatar-slot");
		expect(slot?.getAttribute("data-visible")).toBe("false");
		// 收起是宽度过渡，头像必须还在，否则会先凭空消失再收一个空盒子。
		expect(slot?.querySelectorAll("img")).toHaveLength(1);
	});
});
