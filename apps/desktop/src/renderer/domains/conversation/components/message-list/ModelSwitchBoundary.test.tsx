// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";
import enChat from "@/shared/i18n/locales/en/chat.json";
import zhChat from "@/shared/i18n/locales/zh/chat.json";
import { ModelSwitchBoundary } from "./MessageItem";

describe("ModelSwitchBoundary", () => {
	it.each([
		["zh", "模型已从 GPT-4 切换为 GPT-5"],
		["en", "Switched model from GPT-4 to GPT-5"],
	])("shows the previous and selected model in %s", async (language, label) => {
		const i18n = createInstance();
		await i18n.init({
			resources: { zh: { chat: zhChat }, en: { chat: enChat } },
			lng: language,
			fallbackLng: "zh",
			ns: ["chat"],
			defaultNS: "chat",
			initAsync: false,
		});
		render(
			<I18nextProvider i18n={i18n}>
				<ModelSwitchBoundary from="GPT-4" to="GPT-5" />
			</I18nextProvider>,
		);
		expect(screen.getByText(label)).toBeTruthy();
	});
});
