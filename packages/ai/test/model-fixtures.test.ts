import { describe, expect, it } from "vitest";
import { getModel, getModels } from "../src/models.js";

describe("test model catalog", () => {
	it("installs deterministic models without restoring a production catalog", () => {
		expect(getModels("amazon-bedrock").length).toBeGreaterThan(0);
		expect(getModels("opencode").length).toBeGreaterThan(0);
	});

	it.each([
		["anthropic", "claude-opus-4-6", "anthropic-messages"],
		["openai", "gpt-4o-mini", "openai-responses"],
		["github-copilot", "gpt-4o", "openai-completions"],
		["github-copilot", "claude-sonnet-4", "anthropic-messages"],
		["amazon-bedrock", "global.anthropic.claude-sonnet-4-5-20250929-v1:0", "bedrock-converse-stream"],
	])("maps %s/%s to %s", (provider, modelId, api) => {
		const model = getModel(provider, modelId);

		expect(model).toMatchObject({ provider, id: modelId, api });
	});
});
