// @vitest-environment jsdom

import { createConversationUserMessage } from "@shared/conversation";
import { renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { MessageListProps } from "../components/message-list/types";
import type { MessageListScrollModel } from "./useMessageListScrollModel";
import { useMessageListModel } from "./useMessageListModel";

const modelOptions = vi.hoisted(() => ({
	options: [] as Array<{ provider: string; modelId: string; displayName: string; key: string }>,
	labelFor: (provider: string) => ({ openai: "OpenAI", anthropic: "Anthropic" })[provider] ?? provider,
}));

vi.mock("@shared/components/ModelSelect/useModelOptions", () => ({
	useModelOptions: () => modelOptions,
}));

beforeEach(() => {
	modelOptions.options = [];
});

it("keeps the message-list view model stable when its inputs did not change", () => {
	const messages = [createConversationUserMessage({ id: "message-1", text: "hello" })];
	const props: MessageListProps = {
		messages,
		isStreaming: false,
		workspace: { id: "workspace-1", cwd: "C:/workspace", runtimeIds: [] },
	};
	const scroll = {} as MessageListScrollModel;
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

it("includes providers when identically named models are switched", () => {
	modelOptions.options = [
		{ provider: "openai", modelId: "shared", displayName: "Shared", key: "openai/shared" },
		{ provider: "anthropic", modelId: "shared", displayName: "Shared", key: "anthropic/shared" },
	];
	const messages = [
		createConversationUserMessage({
			id: "message-1",
			text: "first",
			model: { provider: "openai", id: "shared" },
		}),
		createConversationUserMessage({
			id: "message-2",
			text: "second",
			model: { provider: "anthropic", id: "shared" },
		}),
	];
	const props: MessageListProps = {
		messages,
		isStreaming: false,
		workspace: { id: "workspace-1", cwd: "C:/workspace", runtimeIds: [] },
	};

	const { result } = renderHook(() => useMessageListModel(props, {} as MessageListScrollModel, messages));

	expect(result.current.modelSwitchLabels.get("message-2")).toEqual({
		from: "OpenAI (Shared)",
		to: "Anthropic (Shared)",
	});
});
