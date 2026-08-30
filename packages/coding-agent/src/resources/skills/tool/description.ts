import { SKILL_SELECTION_GUIDANCE } from "../usage-guidance.js";

export const INVOKE_SKILL_TOOL_DESCRIPTION = `Invoke a skill by name. Skills are specialized instruction sets for specific tasks (e.g., processing PDF files, handling DOCX documents, data analysis).

${SKILL_SELECTION_GUIDANCE}

The tool reads the skill's instruction file, strips metadata, and returns the full skill content. Follow the returned instructions to complete the task.

NEVER use bash commands like find, locate, or mdfind to search for skill files. Always use this tool with the exact skill name from <available_skills>.`;
