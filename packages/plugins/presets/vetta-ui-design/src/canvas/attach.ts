import type { PluginPromptAttachment } from "@vetta-org/plugin-sdk";
import type { DesignSession } from "../vetd/design-session";

export function themeTokenAttachment(session: DesignSession, token: string, label: string): PluginPromptAttachment {
	return {
		id: `vetd-token-${token}`,
		label,
		icon: "palette",
		instructions: [
			[
				`The user selected the design color token --color-${token} from the shared theme.`,
				`Theme file: ${session.dirPath}/theme.css (Tailwind v4 @theme block; all frames share it).`,
				"If asked to change it, edit the token value there — every frame updates via hot reload.",
			].join("\n"),
		],
		metadata: { kind: "vetd-token", token },
	};
}
