// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { createConversationUserMessage } from "@shared/conversation";
import { getDefaultStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./useSkillTokenMeta", () => ({ useSkillTokenMeta: () => vi.fn() }));

const atoms = await import("@shared/store/atoms");
const { projectUserMessage } = await import("../components/message-list/userMessageProjection");
const { useUserMessageCopyAction } = await import("./useUserMessageActions");

describe("useUserMessageCopyAction", () => {
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
		const projection = projectUserMessage(
			createConversationUserMessage({
					id: "user-with-image",
					text: "describe this image",
					images: [{ data: "AQID", mimeType: "image/png", name: "sample.png" }],
			}),
		);
		const { result } = renderHook(() =>
			useUserMessageCopyAction(projection.copyText, projection.copyImageSources),
		);
		await act(() => result.current());

		expect(writeUserMessage).toHaveBeenCalledWith({
			text: "describe this image",
			images: [{ kind: "data-url", dataUrl: "data:image/png;base64,AQID" }],
		});
		expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
	});
});
