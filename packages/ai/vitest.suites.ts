export const AI_INTEGRATION_TEST_FILES = ["test/cache-retention.test.ts"] as const;

export const AI_LIVE_TEST_FILES = [
	"test/abort.test.ts",
	"test/anthropic-tool-name-normalization.test.ts",
	"test/context-overflow.test.ts",
	"test/cross-provider-handoff.test.ts",
	"test/empty.test.ts",
	"test/image-tool-result.test.ts",
	"test/interleaved-thinking.test.ts",
	"test/openai-responses-reasoning-replay-e2e.test.ts",
	"test/stream.test.ts",
	"test/tokens.test.ts",
	"test/tool-call-id-normalization.test.ts",
	"test/tool-call-without-result.test.ts",
	"test/total-tokens.test.ts",
	"test/unicode-surrogate.test.ts",
	"test/xhigh.test.ts",
	"test/zen.test.ts",
] as const;

export const AI_TEST_DEFAULTS = {
	globals: true,
	environment: "node",
	setupFiles: ["./test/setup.ts"],
	testTimeout: 30_000,
} as const;
