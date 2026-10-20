import { describe, expect, it } from "vitest";
import { menuPathsBelow } from "../src/components/GitFileTree";
import type { ChangeEntry } from "../src/git/types";

const entries: ChangeEntry[] = [
	{ path: "src/app.ts", code: "M" },
	{ path: "src/components/Header.tsx", code: "A" },
	{ path: "src/components/Sidebar.tsx", code: "M" },
	{ path: "srcs/not-a-child.ts", code: "M" },
	{ path: "README.md", code: "M" },
];

describe("directory context menu targets", () => {
	it("expands a directory row into every changed file below it", () => {
		expect(menuPathsBelow("src", entries)).toEqual(["src/app.ts", "src/components/Header.tsx", "src/components/Sidebar.tsx"]);
	});

	it("does not treat a sibling with a shared name prefix as a child", () => {
		expect(menuPathsBelow("src/components", entries)).toEqual(["src/components/Header.tsx", "src/components/Sidebar.tsx"]);
		expect(menuPathsBelow("src", entries)).not.toContain("srcs/not-a-child.ts");
	});

	it("returns nothing for a path without changed descendants", () => {
		expect(menuPathsBelow("docs", entries)).toEqual([]);
	});
});
