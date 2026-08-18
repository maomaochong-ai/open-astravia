import { describe, expect, it } from "vitest";
import { resolveAbilitySourcePresentation } from "./ability-source-presentation";

describe("resolveAbilitySourcePresentation", () => {
	it("maps local source kinds to localized labels", () => {
		expect(resolveAbilitySourcePresentation({ kind: "builtin", id: "builtin" })).toEqual({
			nameKey: "detail.source.builtin",
		});
		expect(resolveAbilitySourcePresentation({ kind: "local", id: "local" })).toEqual({
			nameKey: "detail.source.local",
		});
		expect(resolveAbilitySourcePresentation({ kind: "server", id: "server" })).toEqual({
			nameKey: "detail.source.server",
		});
	});

	it("keeps the GitHub source name and repository for footer metadata", () => {
		expect(
			resolveAbilitySourcePresentation({
				kind: "github",
				id: "community",
				name: "Community Market",
				repository: "https://github.com/example/community-market",
			}),
		).toEqual({
			name: "Community Market",
			repository: "https://github.com/example/community-market",
		});
	});
});
