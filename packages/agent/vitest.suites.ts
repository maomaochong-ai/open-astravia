import { fileURLToPath } from "node:url";

export const liveTestFiles = ["test/e2e.test.ts", "test/bedrock-models.test.ts"];

export const resolveAliases = {
	"@astravia/ai/testkit": fileURLToPath(new URL("../ai/src/testkit/index.ts", import.meta.url)),
	"@astravia/ai": fileURLToPath(new URL("../ai/src/index.ts", import.meta.url)),
};

export const defaultTestOptions = {
	globals: true,
	environment: "node" as const,
	testTimeout: 30000,
};
