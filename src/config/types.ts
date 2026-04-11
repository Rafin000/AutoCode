export interface RepoConfig {
  name: string;
  path: string;
}

export interface LLMConfig {
  provider: "anthropic" | "openai";
  model: string;
}

export interface GraphConfig {
  url: string;
  username: string;
  password: string;
}

export interface VectorConfig {
  url: string;
  collection: string;
}

export interface EmbedderConfig {
  model: string;
  dimensions: number;
}

export interface ApiConfig {
  /** URL of the deployed Cloudflare Worker API. If set, CLI uses remote stores. */
  url?: string;
}

export interface Config {
  version: number;
  repos: RepoConfig[];
  llm: LLMConfig;
  /** Optional remote API. When set, features/rules/vectors go through the Worker. */
  api?: ApiConfig;
  knowledge: {
    graph: GraphConfig;
    vectors: VectorConfig;
  };
  embedder: EmbedderConfig;
}

export const DEFAULT_CONFIG: Config = {
  version: 1,
  repos: [],
  llm: {
    provider: "anthropic",
    model: "claude-sonnet-4-6",
  },
  knowledge: {
    graph: {
      url: "bolt://localhost:7687",
      username: "neo4j",
      password: "repo-agent",
    },
    vectors: {
      url: "http://localhost:6333",
      collection: "auto-coder",
    },
  },
  embedder: {
    model: "Xenova/all-MiniLM-L6-v2",
    dimensions: 384,
  },
};
