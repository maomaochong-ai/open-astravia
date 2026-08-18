import { join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";

export function getKnowledgeRoot(): string {
	return join(getVettaHomePath(), "knowledges");
}
