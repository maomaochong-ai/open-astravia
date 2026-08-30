export const SKILL_SELECTION_GUIDANCE =
	"Match skills by the user's requested outcome and target resource, including context already established in the conversation. " +
	"Skills may support planning, creation, or review; use a relevant skill without requiring the user to name it or already have a project. Preserve its declared capabilities and use the steps needed to fulfill the request. " +
	"A shared topic or keyword alone is not a match. Check the advertised exclusions before selecting a skill; explaining a workflow does not request its execution. " +
	"When an available skill fits the actual task, invoke it before using its method. If none fits, continue with the appropriate available tools. " +
	"Loading a skill supplies instructions, not authorization to create projects, install integrations, spend quota, send messages, or schedule work outside the user's request.";
