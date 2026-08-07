import type { ExtensionAPI, ExtensionContext } from "@vetta/coding-agent";

const COMPACT_THRESHOLD_TOKENS = 100_000;

export default function (api: ExtensionAPI) {
	const triggerCompaction = (ctx: ExtensionContext, customInstructions?: string) => {
		if (ctx.hasUI) {
			ctx.ui.notify("Compaction started", "info");
		}
		ctx.compact({
			customInstructions,
			onComplete: () => {
				if (ctx.hasUI) {
					ctx.ui.notify("Compaction completed", "info");
				}
			},
			onError: (error) => {
				if (ctx.hasUI) {
					ctx.ui.notify(`Compaction failed: ${error.message}`, "error");
				}
			},
		});
	};

	api.on("turn_end", (_event, ctx) => {
		const usage = ctx.getContextUsage();
		if (!usage || usage.tokens === null || usage.tokens <= COMPACT_THRESHOLD_TOKENS) {
			return;
		}
		triggerCompaction(ctx);
	});

	api.registerCommand("trigger-compact", {
		description: "Trigger compaction immediately",
		handler: async (args, ctx) => {
			const instructions = args.trim() || undefined;
			triggerCompaction(ctx, instructions);
		},
	});
}
