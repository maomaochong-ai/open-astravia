import { definePlugin } from "@vetta-org/plugin-sdk";
import type { JSX } from "react";
import { SettingsView, type SettingsPorts } from "./components/SettingsView.js";
import { setPluginCtx } from "./plugin-context.js";
import { createComfyUiProvider } from "./provider.js";
import { getSettingsStore, resetSettingsStore } from "./settings/settings-instance.js";
import "./style.css";

const WORKSPACE_VIEW_ID = "settings";

export default definePlugin({
	activate(ctx) {
		setPluginCtx(ctx);
		resetSettingsStore();
		const store = getSettingsStore();
		// Provider 在生成时同步读配置，先把存储里的值拉起来，避免首个任务打到默认地址。
		void store.load();

		const ports: SettingsPorts = {
			store,
			probe: async (baseUrl) => {
				try {
					const response = await ctx.network.request<unknown>({
						url: `${baseUrl.trim().replace(/\/$/, "")}/queue`,
						method: "GET",
						responseType: "json",
						timeoutMs: 8_000,
					});
					return response.ok ? { ok: true } : { ok: false, detail: `HTTP ${response.status}` };
				} catch (error) {
					return { ok: false, detail: error instanceof Error ? error.message : String(error) };
				}
			},
		};

		ctx.ui.registerWorkspaceView({
			id: WORKSPACE_VIEW_ID,
			label: "%settings.title%",
			icon: "icon-[solar--video-frame-play-horizontal-linear]",
			description: "%settings.tagline%",
			component: function ComfyUiSettingsView(): JSX.Element {
				return <SettingsView ports={ports} />;
			},
		});

		ctx.media.registerProvider(createComfyUiProvider(ctx));
	},
	deactivate() {
		resetSettingsStore();
	},
});
