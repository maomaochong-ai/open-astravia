import type { AgentConfigurationSelection } from "@vetta/coding-agent/profile";
import { atom } from "jotai";

/** The next conversation receives an independent, persisted copy of this in-memory choice. */
export const newSessionAgentConfigurationAtom = atom<AgentConfigurationSelection>({ template: null, overrides: {} });
