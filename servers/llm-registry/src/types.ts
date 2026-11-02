/** Mirrors LlmRegistry/registry/models.schema.json (and the app's src/data/types.ts). */

export type ProviderKind = "openai-compatible" | "anthropic";
export type Access = "closed" | "open-weight" | "open-source";
export type Status = "current" | "preview" | "deprecated" | "local";
export type Capability = "tools" | "vision" | "json" | "reasoning" | "audio" | "embeddings";

export interface Provider {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  keyEnv?: string | null;
  browser?: boolean;
  docs?: string;
  notes?: string;
}

export interface Pricing {
  input: number;
  output: number;
}

export interface Model {
  id: string;
  name: string;
  vendor: string;
  provider: string;
  modelId: string;
  modelIdVerified?: boolean;
  access: Access;
  license?: string;
  status: Status;
  released?: string;
  contextWindow?: number | null;
  pricing?: Pricing | null;
  capabilities?: Capability[];
  tags: string[];
  homepage?: string;
  notes?: string;
}

export interface GroupFilter {
  allTags?: string[];
  anyTags?: string[];
  noneTags?: string[];
  providers?: string[];
  vendors?: string[];
  access?: string[];
  status?: string[];
  capabilities?: string[];
  maxInputPrice?: number;
  minContext?: number;
  ids?: string[];
}

export interface Group {
  id: string;
  name: string;
  description?: string;
  filter: GroupFilter;
}

export interface Operation {
  id: string;
  name: string;
  description?: string;
  system?: string;
  prompt: string;
}

export interface Registry {
  version: number;
  updated?: string;
  notes?: string[];
  providers: Provider[];
  models: Model[];
  groups: Group[];
  operations?: Operation[];
}

export interface Usage {
  inputTokens: number | null;
  outputTokens: number | null;
}
