import { definePlugin } from "@vetta-org/plugin-sdk";
import { GlobalProbeSlot } from "./GlobalProbeSlot";
import { ProbePanel } from "./ProbePanel";
import { setPluginCtx } from "./plugin-context";
import "./style.css";

const TAB_ID = "probe";

export default definePlugin({
	activate(ctx) {
		setPluginCtx(ctx);

		ctx.ui.registerGlobalSlot({
			id: "security-probe-panel",
			component: GlobalProbeSlot,
		});

		ctx.ui.registerActivityTab({
			id: TAB_ID,
			label: "%tab.label%",
			icon: (
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
					<path d="M12 3 4.5 6.5v5c0 4.4 3.1 8.4 7.5 9.5 4.4-1.1 7.5-5.1 7.5-9.5v-5L12 3Z" />
					<path d="M9.2 12.2 11 14l3.8-4" strokeLinecap="round" strokeLinejoin="round" />
				</svg>
			),
			component: ProbePanel,
			scope_use: ["conversation", "project", "cli"],
			initiallyVisible: true,
		});

		try {
			ctx.ui.openActivityTab(TAB_ID, { width: 420 });
		} catch {
			// Missing activity-tab grant or no active cwd — global slot still works.
		}
	},
});
