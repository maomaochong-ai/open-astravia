// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AbilitiesModel, McpAbility } from "../types";
import { McpSetupPrompt } from "./McpSetupPrompt";

const item = {
	type: "mcp",
	id: "github:official:mcp:xiaohongshu-mcp",
	title: "小红书",
	serverName: "xiaohongshu-mcp",
	postInstallSetup: { kind: "http-qrcode" },
} as McpAbility;

describe("McpSetupPrompt", () => {
	it("does not open a dialog until the QR code is ready", async () => {
		let resolveStart:
			| ((value: { state: "qr_code"; image: string; expiresInSeconds: number }) => void)
			| undefined;
		const startSetupLogin = vi.fn(
			() =>
				new Promise<{ state: "qr_code"; image: string; expiresInSeconds: number }>((resolve) => {
					resolveStart = resolve;
				}),
		);
		(window as unknown as { vetta: unknown }).vetta = {
			mcp: {
				startSetupLogin,
				getSetupLoginStatus: vi.fn(async () => ({ state: "unauthenticated" })),
				cancelSetupLogin: vi.fn(async () => undefined),
			},
		};
		const model = {
			setupPromptId: item.id,
			allItems: [item],
			refresh: vi.fn(),
			dismissSetupPrompt: vi.fn(),
		} as unknown as AbilitiesModel;

		render(<McpSetupPrompt model={model} />);
		expect(screen.queryByRole("dialog")).toBeNull();

		resolveStart?.({
			state: "qr_code",
			image: "data:image/png;base64,iVBORw0KGgo=",
			expiresInSeconds: 60,
		});
		await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
	});
});
