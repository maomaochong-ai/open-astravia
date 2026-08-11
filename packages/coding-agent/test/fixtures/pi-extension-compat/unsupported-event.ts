// @ts-expect-error Resolved by the explicit Pi compatibility loader facade.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (api: ExtensionAPI) {
	api.on("agent_settled", () => {});
}
