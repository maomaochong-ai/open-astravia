// @vitest-environment jsdom

import { render, renderHook, screen } from "@testing-library/react";
import { createConversationUserMessage } from "@shared/conversation";
import userEvent from "@testing-library/user-event";
import { getDefaultStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./useSkillTokenMeta", () => ({ useSkillTokenMeta: () => vi.fn() }));

const atoms = await import("@shared/store/atoms");
const { useUserMessageModel } = await import("./useUserMessageModel");

describe("useUserMessageModel clipboard", () => {
	beforeEach(() => {
		const store = getDefaultStore();
		store.set(atoms.pendingMessageEditAtom, null);
		const writeText = vi.fn(async () => undefined);
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText },
		});
	});

	it("copies user-message text and images through the rich clipboard contract", async () => {
		const writeUserMessage = vi.fn(async () => undefined);
		Object.defineProperty(window, "vetta", {
			configurable: true,
			value: { clipboard: { writeUserMessage } },
		});
		const { result } = renderHook(() =>
			useUserMessageModel({
				message: createConversationUserMessage({
					id: "user-with-image",
					text: "describe this image",
					images: [{ data: "AQID", mimeType: "image/png", name: "sample.png" }],
				}),
			}),
		);

		render(result.current.copyButton);
		await userEvent.click(screen.getByRole("button", { name: "messageList.copyButton.copy" }));

		expect(writeUserMessage).toHaveBeenCalledWith({
			text: "describe this image",
			images: [{ kind: "data-url", dataUrl: "data:image/png;base64,AQID" }],
		});
		expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
	});
});
