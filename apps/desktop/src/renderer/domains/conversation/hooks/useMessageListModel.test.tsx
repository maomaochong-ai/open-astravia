// @vitest-environment jsdom

import { createConversationUserMessage } from "@shared/conversation";
import { renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { MessageListProps } from "../components/message-list/types";
import type { MessageListScrollModel } from "./useMessageListScrollModel";
import { useMessageListModel } from "./useMessageListModel";

const modelOptions = vi.hoisted(() => ({ options: [] }));

vi.mock("@shared/components/ModelSelect/useModelOptions", () => ({
	useModelOptions: () => modelOptions,
}));

it("keeps the message-list view model stable when its inputs did not change", () => {
	const messages = [createConversationUserMessage({ id: "message-1", text: "hello" })];
	const props: MessageListProps = {
		messages,
		isStreaming: false,
		workspace: { id: "workspace-1", cwd: "C:/workspace", runtimeIds: [] },
	};
	const scroll = {
		historyBufferEnabled: false,
	} as MessageListScrollModel;
	const { result, rerender } = renderHook(
		({ renderPass }) => {
			void renderPass;
			return useMessageListModel(props, scroll, messages);
		},
		{ initialProps: { renderPass: 0 } },
	);
	const first = result.current;

	rerender({ renderPass: 1 });

	expect(result.current).toBe(first);
	expect(result.current.participants).toBe(first.participants);
});
