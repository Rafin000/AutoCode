/**
 * Whitelisted graph schema.
 *
 * Every node label and edge type used by auto-coder must be in one of
 * these sets. The graph client refuses to create anything that isn't
 * whitelisted, which prevents Cypher injection via bad input and
 * keeps the schema focused.
 */

export const NODE_LABELS = [
  "Repo",         // a registered repo
  "Project",      // logical grouping (subdir, package, module)
  "Function",     // extracted function or method
  "Class",        // class definition
  "Technology",   // language, framework, library (TypeScript, Neo4j, Hono)
  "Skill",        // high-level skill (RAG, agentic systems, streaming)
  "Topic",        // domain concept (rate limiting, retry, auth)
  "Concept",      // any other named entity worth tracking
  "Document",     // README, blog post, CV section
  "HardRule",     // inviolable constraint
  "SoftRule",     // learned pattern with confidence score
  "AntiPattern",  // what NOT to do
] as const;

export type NodeLabel = (typeof NODE_LABELS)[number];

export const EDGE_TYPES = [
  "USES",          // Repo   ─USES→        Technology
  "CONTAINS",      // Repo   ─CONTAINS→    Function / Class / Document
  "DEMONSTRATES",  // Repo   ─DEMONSTRATES→ Skill
  "BUILT_WITH",    // Project ─BUILT_WITH→  Technology
  "ABOUT",         // Function ─ABOUT→     Topic
  "MENTIONS",      // Document ─MENTIONS→  Concept
  "DEFINED_IN",    // Function ─DEFINED_IN→ Repo (reverse convenience)
  "CONSTRAINS",    // HardRule ─CONSTRAINS→ Repo / Function / Technology
  "APPLIES_IN",    // SoftRule ─APPLIES_IN→ Repo
  "APPLIES_TO",    // SoftRule ─APPLIES_TO→ Function / Technology
  "WARNS_ABOUT",   // AntiPattern ─WARNS_ABOUT→ Repo / Function
  "CALLS",         // Function ─CALLS→ Function (cross-service)
  "BREAKS_IF_CHANGED", // cross-service dependency
  "REFERENCES",    // generic cross-reference
] as const;

export type EdgeType = (typeof EDGE_TYPES)[number];

export function isValidLabel(label: string): label is NodeLabel {
  return (NODE_LABELS as readonly string[]).includes(label);
}

export function isValidEdge(edge: string): edge is EdgeType {
  return (EDGE_TYPES as readonly string[]).includes(edge);
}

export function assertValidLabel(label: string): asserts label is NodeLabel {
  if (!isValidLabel(label)) {
    throw new Error(
      `Invalid node label "${label}". Allowed: ${NODE_LABELS.join(", ")}`,
    );
  }
}

export function assertValidEdge(edge: string): asserts edge is EdgeType {
  if (!isValidEdge(edge)) {
    throw new Error(
      `Invalid edge type "${edge}". Allowed: ${EDGE_TYPES.join(", ")}`,
    );
  }
}
