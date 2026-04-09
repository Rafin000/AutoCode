import { Config, RepoConfig } from "../config/types.js";
import { assembleContext, AssembledContext } from "../retriever/assembler.js";

export interface FeatureContext extends AssembledContext {
  repo: RepoConfig;
  branchName: string;
}

/**
 * Build the context block for a feature implementation.
 *
 * For v1, this is essentially the same retrieval as `ask`, but
 * scoped to a single repo and with a slightly larger K. Later
 * additions could include:
 *   - Related functions (graph hop from vector matches)
 *   - Files previously modified for similar features
 *   - Rules and anti-patterns (when we add a rules engine)
 */
export async function buildFeatureContext(
  config: Config,
  repo: RepoConfig,
  featureId: string,
  description: string,
): Promise<FeatureContext> {
  const assembled = await assembleContext(config, description, {
    repo: repo.name,
    topK: 12,
  });

  const branchName = `agent/${featureId}`;

  return {
    ...assembled,
    repo,
    branchName,
  };
}
