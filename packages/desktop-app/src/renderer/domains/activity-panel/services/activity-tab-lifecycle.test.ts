import type { ActivityTabKey } from "@shared/lib/project-profile";
import { describe, expect, it } from "vitest";
import type { ActivityTabDefinition, ResolvedActivityTab } from "../registry/types";
import { resolveMountedActivityTabs } from "./activity-tab-lifecycle";

function tab(id: string, options: { keepAlive?: boolean } = {}): ResolvedActivityTab {
	const definition: ActivityTabDefinition = {
		id,
		source: "builtin",
		useMeta: () => ({ label: id }),
		component: () => null,
		keepAliveWhenAvailable: options.keepAlive,
	};
	return {
		id,
		label: id,
		removable: true,
		source: "builtin",
		definition,
	};
}

describe("activity tab lifecycle policy", () => {
	it("mounts active, floating, and keep-alive tabs without mounting other inactive tabs", () => {
		const candidates = [tab("file"), tab("browser"), tab("plugin:test:kept", { keepAlive: true }), tab("todo")];

		expect(
			resolveMountedActivityTabs(candidates, new Set<ActivityTabKey>(["browser"]), "file").map((item) => item.id),
		).toEqual(["file", "browser", "plugin:test:kept"]);
	});
});
