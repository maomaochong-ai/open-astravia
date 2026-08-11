/**
 * Prompt Templates
 *
 * File-based templates that inject content when invoked with /templatename.
 */

import type { CodingAgentPromptTemplateContribution } from "@vetta/coding-agent/sdk";
import { createCodingAgentSession } from "@vetta/coding-agent/sdk";

// Define custom templates
const deployTemplate: CodingAgentPromptTemplateContribution = {
	name: "deploy",
	description: "Deploy the application",
	content: `# Deploy Instructions

1. Build: npm run build
2. Test: npm test
3. Deploy: npm run deploy`,
};

const { session } = await createCodingAgentSession({
	storage: { kind: "memory" },
	resources: { promptTemplates: [deployTemplate] },
});

// Includes templates discovered from the workspace and the explicit SDK contribution.
const discovered = session.getPromptTemplates();
console.log("Discovered prompt templates:");
for (const template of discovered) {
	console.log(`  /${template.name}: ${template.description}`);
}

console.log(`Session created with ${discovered.length} prompt templates`);
