import { runMcpCapabilityExample } from "./01-mcp-capability.js";
import { runSkillCapabilityExample } from "./02-skill-capability.js";
import { runSessionExtensionCapabilityExample } from "./03-session-extension-capability.js";

const mcp = await runMcpCapabilityExample();
const skills = await runSkillCapabilityExample();
const sessionExtension = await runSessionExtensionCapabilityExample();

console.log(JSON.stringify({ mcp, skills, sessionExtension }, null, 2));
