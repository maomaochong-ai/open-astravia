import { join } from "node:path";
import { getAstraviaHomePath } from "@astravia/action-rpc";

export function getKnowledgeRoot(): string {
	return join(getAstraviaHomePath(), "knowledges");
}
