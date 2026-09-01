import { runPeerAgentsExample } from "./01-peer-agents.js";
import { runRevisionRolloutExample } from "./02-revision-rollout.js";

const peerAgents = await runPeerAgentsExample();
const revisionRollout = await runRevisionRolloutExample();

console.log(JSON.stringify({ peerAgents, revisionRollout }, null, 2));
