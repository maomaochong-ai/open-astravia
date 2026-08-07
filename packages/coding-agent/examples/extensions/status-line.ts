/**
 * Status Line Extension
 *
 * Demonstrates ctx.ui.setStatus() for displaying persistent status text in the footer.
 * Shows turn progress with themed colors.
 */

import type { ExtensionAPI } from "@vetta/coding-agent";

export default function (api: ExtensionAPI) {
	let turnCount = 0;

	api.on("session_start", async (_event, ctx) => {
		const theme = ctx.ui.theme;
		ctx.ui.setStatus("status-demo", theme.fg("dim", "Ready"));
	});

	api.on("turn_start", async (_event, ctx) => {
		turnCount++;
		const theme = ctx.ui.theme;
		const spinner = theme.fg("accent", "●");
		const text = theme.fg("dim", ` Turn ${turnCount}...`);
		ctx.ui.setStatus("status-demo", spinner + text);
	});

	api.on("turn_end", async (_event, ctx) => {
		const theme = ctx.ui.theme;
		const check = theme.fg("success", "✓");
		const text = theme.fg("dim", ` Turn ${turnCount} complete`);
		ctx.ui.setStatus("status-demo", check + text);
	});

	api.on("session_switch", async (event, ctx) => {
		if (event.reason === "new") {
			turnCount = 0;
			const theme = ctx.ui.theme;
			ctx.ui.setStatus("status-demo", theme.fg("dim", "Ready"));
		}
	});
}
