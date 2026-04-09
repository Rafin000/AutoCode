/**
 * Minimal template engine for pipeline configs.
 *
 * Supports `{{ path.to.value }}` expressions where the path is a
 * dot-separated lookup into a context object. Context shape:
 *
 *   {
 *     inputs: Record<string, unknown>,
 *     steps:  Record<string, { output: Record<string, unknown> }>
 *   }
 *
 * Design notes:
 * - Walks the config object recursively — strings inside arrays or
 *   nested objects are resolved too.
 * - If an expression resolves to undefined, it's replaced with the
 *   empty string. This keeps templates forgiving; executors decide
 *   whether a missing value is actually an error.
 * - If an expression resolves to a non-string value AND the template
 *   has ONLY that expression (no surrounding text), the value is
 *   returned as-is — so `{{ steps.search.output.results }}` can
 *   preserve its array type instead of becoming `[object Object]`.
 */

export interface TemplateContext {
  inputs: Record<string, unknown>;
  steps: Record<string, { output: Record<string, unknown> }>;
}

const EXPR_REGEX = /\{\{\s*([^}]+?)\s*\}\}/g;
const FULL_EXPR_REGEX = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;

/**
 * Resolve every `{{ ... }}` expression in `value`.
 * Objects and arrays are walked recursively; primitives are returned
 * unchanged (except strings which get substitution).
 */
export function resolveTemplate(
  value: unknown,
  ctx: TemplateContext,
): unknown {
  if (value == null) return value;

  if (typeof value === "string") {
    return resolveString(value, ctx);
  }

  if (Array.isArray(value)) {
    return value.map((v) => resolveTemplate(v, ctx));
  }

  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = resolveTemplate(v, ctx);
    }
    return out;
  }

  return value;
}

function resolveString(s: string, ctx: TemplateContext): unknown {
  // Special case: the string is JUST one expression and nothing else.
  // Preserve the value's original type (useful for passing arrays/objects).
  const fullMatch = FULL_EXPR_REGEX.exec(s);
  if (fullMatch && fullMatch[1]) {
    const resolved = getPath(ctx, fullMatch[1].trim());
    return resolved ?? "";
  }

  // General case: replace every expression inline, coercing to strings.
  return s.replace(EXPR_REGEX, (_match, expr: string) => {
    const resolved = getPath(ctx, expr.trim());
    if (resolved == null) return "";
    if (typeof resolved === "string") return resolved;
    if (typeof resolved === "number" || typeof resolved === "boolean") {
      return String(resolved);
    }
    return JSON.stringify(resolved);
  });
}

/**
 * Dot-path lookup with safe traversal. `inputs.foo.bar` walks
 * ctx.inputs.foo.bar and returns undefined on any missing step.
 */
function getPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}
