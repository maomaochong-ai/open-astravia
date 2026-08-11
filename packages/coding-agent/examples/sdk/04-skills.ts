/**
 * Skills Configuration
 *
 * Skills provide specialized instructions loaded into the system prompt.
 * Discover, filter, merge, or refresh them through stable value contracts.
 */

import type { CodingAgentSkillSourceSnapshot } from "@vetta/coding-agent/sdk";
import { createCodingAgentSession } from "@vetta/coding-agent/sdk";

let dynamicSkills: CodingAgentSkillSourceSnapshot = {
	revision: 1,
	skills: [
		{
			name: "browser-audit",
			description: "Audit browser changes",
			content: "Inspect browser-visible behavior and report regressions.",
		},
	],
};

const { session } = await createCodingAgentSession({
	storage: { kind: "memory" },
	resources: {
		skillPolicy: { include: { nameContains: ["browser", "search", "project"] } },
		skills: [
			{
				name: "project-guidance",
				description: "Custom project instructions",
				content: "Preserve existing behavior and keep changes surgical.",
			},
		],
	},
	skillSources: [{ id: "live-skills", read: () => dynamicSkills }],
});

console.log(
	"Visible skills:",
	session.getSkills().map(({ name }) => name),
);

dynamicSkills = {
	revision: 2,
	skills: [
		{
			name: "search-audit",
			description: "Audit search changes",
			content: "Inspect search behavior and report regressions.",
		},
	],
};
await session.reload();

console.log(
	"Refreshed skills:",
	session.getSkills().map(({ name }) => name),
);
await session.close();
