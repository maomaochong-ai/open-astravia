import type { UserMessage } from "@vetta/ai";
import type { ContinuationPolicyContext } from "@vetta/runtime-core/kernel";

export interface CodingAgentContinuationSource {
	collect(context: ContinuationPolicyContext): Promise<readonly UserMessage[]>;
}
