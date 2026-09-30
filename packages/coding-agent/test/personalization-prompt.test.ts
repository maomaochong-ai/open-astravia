import { describe, expect, it } from "vitest";
import { buildPersonalizationBlock } from "../src/model-context/system-prompt-sources.js";
import { getPersonaPrompt, PERSONAS } from "../src/profiles/index.js";
import { formatSkillsForPrompt } from "../src/resources/skills/prompt.js";

function settings(personaId: string, customPrompt: string) {
	return { getPersonalization: () => ({ personaId, customPrompt }) };
}

describe("persona prompts", () => {
	const filePersonas = PERSONAS.filter((persona) => persona.prompt.length > 0);

	// 身份只由核心 `Your name is Vetta` 声明一次；人设改写的是协作风格，不是另一个身份。
	it.each(filePersonas.map((persona) => persona.id))("%s does not claim a separate identity", (id) => {
		const prompt = getPersonaPrompt(id);
		expect(prompt.startsWith("# Persona:")).toBe(true);
		expect(prompt).not.toMatch(/You are "/);
	});

	it("interactive persona states that it replaces the mode's autonomy default", () => {
		expect(getPersonaPrompt("interactive")).toContain("replaces any default to act autonomously");
	});
});

describe("buildPersonalizationBlock", () => {
	it("places persona first and fences custom instructions under their own heading", () => {
		const block = buildPersonalizationBlock(settings("pragmatic", "  Answer in bullet points.  "));

		expect(block).toBe(`${getPersonaPrompt("pragmatic")}\n\n# User custom instructions\n\nAnswer in bullet points.`);
	});

	it("emits only the custom instructions when the default persona is selected", () => {
		expect(buildPersonalizationBlock(settings("default", "Be brief."))).toBe(
			"# User custom instructions\n\nBe brief.",
		);
	});

	it("emits nothing when neither persona nor custom instructions are set", () => {
		expect(buildPersonalizationBlock(settings("default", "   "))).toBeUndefined();
	});
});

describe("skill references in user messages", () => {
	it("tells the model how to handle an @skill reference that matches no listed skill", () => {
		const prompt = formatSkillsForPrompt([
			{ name: "pdf", description: "Handle PDF files", type: "skill", disableModelInvocation: false },
		]);

		expect(prompt).toContain("`@skill:name`");
		expect(prompt).toContain("If no listed skill has that name, say so in one sentence");
	});
});
