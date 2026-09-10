// @vitest-environment jsdom
/**
 * 选项行在窄插槽下要把项目选择器整枚让出去：留在行里会先把「切换智能体」截成省略号，
 * 再和右锚的装饰件叠在一起。让出去之后，模式与智能体两枚 chip 必须原样还在。
 */
import { render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NewSessionOptionsRow } from "./NewSessionOptionsRow";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key, i18n: { exists: () => true } }),
}));

beforeEach(() => {
	Object.assign(window, {
		vetta: {
			config: { get: async () => ({ defaultAgentMode: "work", projects: [] }), onProjectsChanged: () => () => {} },
			im: { onSessionChanged: () => () => {} },
			session: {
				listSandboxGrants: async () => [],
				getAgentModes: async () => [{ id: "work", label: "Work", description: "", icon: "" }],
				onAgentModeChanged: () => () => {},
				onSessionsChanged: () => () => {},
			},
		},
	});
});

function renderRow(showProjectSelector: boolean): void {
	render(
		<Provider store={createStore()}>
			<NewSessionOptionsRow
				selection={null}
				options={[]}
				takenNames={[]}
				creatingProject={false}
				onSelectProject={vi.fn()}
				onSelectPendingProject={vi.fn()}
				showProjectSelector={showProjectSelector}
			/>
		</Provider>,
	);
}

describe("NewSessionOptionsRow", () => {
	it("showProjectSelector 为 false 时不渲染项目选择器", async () => {
		renderRow(false);

		expect(await screen.findByRole("button", { name: "agentMode.work" })).toBeDefined();
		expect(screen.queryByRole("button", { name: "newSession.projectSelector.triggerTitle" })).toBeNull();
	});

	it("默认仍把项目选择器留在行里", async () => {
		renderRow(true);

		expect(await screen.findByRole("button", { name: "agentMode.work" })).toBeDefined();
		expect(screen.getByRole("button", { name: "newSession.projectSelector.triggerTitle" })).toBeDefined();
	});
});
