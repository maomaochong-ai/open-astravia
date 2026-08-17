import { posix } from "node:path";
import { describe, expect, it } from "vitest";
import type { ResourcePathPort } from "../src/resources/contracts/resource-access.js";
import type { ResourcePackageDigestPort } from "../src/resources/contracts/resource-source.js";
import { ResourcePackageLocations } from "../src/resources/packages/resource-package-locations.js";
import { parseResourceSource } from "../src/resources/packages/source-spec.js";

const paths: ResourcePathPort = {
	separator: posix.sep,
	homeDirectory: () => "/home/test",
	basename: posix.basename,
	dirname: posix.dirname,
	isAbsolute: posix.isAbsolute,
	join: posix.join,
	relative: posix.relative,
	resolve: posix.resolve,
};

describe("resource package location ports", () => {
	it("uses injected path semantics and stable digest without ambient Node state", () => {
		const digestInputs: string[] = [];
		const digest: ResourcePackageDigestPort = {
			sha256Hex(value) {
				digestInputs.push(value);
				return "0123456789abcdef";
			},
		};
		const locations = new ResourcePackageLocations({
			cwd: "/workspace/project",
			agentDir: "/home/test/.vetta",
			paths,
			locationFacts: {
				homeDirectory: "/home/test",
				temporaryDirectory: "/tmp",
				getGlobalNpmRoot: () => "/global/node_modules",
			},
			digest,
		});

		expect(locations.resolvePath("~/shared")).toBe("/home/test/shared");
		expect(locations.baseDir("project")).toBe("/workspace/project/.vetta");
		expect(locations.npmInstallPath({ type: "npm", spec: "demo", name: "demo", pinned: false }, "user")).toBe(
			"/global/node_modules/demo",
		);
		const git = parseResourceSource("https://github.com/user/repo");
		if (git.type !== "git") throw new Error("expected git source");
		expect(locations.gitInstallPath(git, "temporary")).toBe("/tmp/pi-extensions/git-github.com/01234567/user/repo");
		expect(digestInputs).toEqual(["git-github.com-user/repo"]);
		expect(locations.identity("./tools", "project")).toBe("local:/workspace/project/.vetta/tools");
		expect(locations.normalizeForSettings("/workspace/project/shared", "project")).toBe("../shared");
	});
});
