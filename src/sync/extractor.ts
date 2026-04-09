import fs from "node:fs";
import path from "node:path";
import { FileCategory, WalkedFile } from "./walker.js";

const MAX_CONTENT_CHARS = 2000;

export type DocumentType =
  | "readme_section"
  | "markdown_section"
  | "function"
  | "class"
  | "technology"
  | "test_file"
  | "config_file";

export interface ExtractedDocument {
  id: string;
  repo: string;
  file_path: string;
  doc_type: DocumentType;
  anchor: string | null;
  content: string;
  metadata: Record<string, unknown>;
}

/**
 * Extract every indexable document from a single file.
 *
 * This is the one place that knows how to turn code/docs/configs into
 * "documents worth indexing." Each document is a self-contained chunk
 * with stable ID, source file path, and a human-readable anchor.
 */
export function extractFromFile(
  file: WalkedFile,
  repo: string,
): ExtractedDocument[] {
  let raw: string;
  try {
    raw = fs.readFileSync(file.absolutePath, "utf-8");
  } catch {
    return [];
  }

  switch (file.category) {
    case "readme":
    case "markdown":
      return extractMarkdown(raw, file, repo);

    case "typescript":
      return extractTypeScript(raw, file, repo);

    case "python":
      return extractPython(raw, file, repo);

    case "package_manifest":
      return extractPackageJson(raw, file, repo);

    case "cargo_manifest":
      return extractCargoToml(raw, file, repo);

    case "python_manifest":
      return extractPyProject(raw, file, repo);

    case "test":
      return extractTestFile(raw, file, repo);

    case "config":
      return [];

    default:
      return [];
  }
}

/* ───── Markdown / README ─────────────────────────────────────────── */

function extractMarkdown(
  raw: string,
  file: WalkedFile,
  repo: string,
): ExtractedDocument[] {
  const sections = splitByHeadings(raw);
  const out: ExtractedDocument[] = [];

  for (const section of sections) {
    if (section.body.trim().length < 40) continue; // skip nearly-empty sections

    const anchor = section.heading ?? "intro";
    const slug = slugify(anchor);

    out.push({
      id: `${repo}:${file.relativePath}:md:${slug}`,
      repo,
      file_path: file.relativePath,
      doc_type: file.category === "readme" ? "readme_section" : "markdown_section",
      anchor,
      content: truncate(`# ${anchor}\n\n${section.body}`),
      metadata: { level: section.level },
    });
  }

  return out;
}

interface MarkdownSection {
  heading: string | null;
  level: number;
  body: string;
}

function splitByHeadings(raw: string): MarkdownSection[] {
  const lines = raw.split("\n");
  const sections: MarkdownSection[] = [];
  let current: MarkdownSection = { heading: null, level: 0, body: "" };

  for (const line of lines) {
    const match = /^(#{1,4})\s+(.*)$/.exec(line);
    if (match) {
      // Push previous section if it has any content
      if (current.body.trim() || current.heading) {
        sections.push(current);
      }
      current = {
        heading: match[2] ? match[2].trim() : null,
        level: match[1] ? match[1].length : 0,
        body: "",
      };
    } else {
      current.body += line + "\n";
    }
  }
  if (current.body.trim() || current.heading) {
    sections.push(current);
  }

  return sections;
}

/* ───── TypeScript / JavaScript ───────────────────────────────────── */

function extractTypeScript(
  raw: string,
  file: WalkedFile,
  repo: string,
): ExtractedDocument[] {
  const out: ExtractedDocument[] = [];

  // Match function declarations
  const fnRegex =
    /(?:^|\n)\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)\s*[(<]/g;
  // Match `const name = (...) => ...` and `const name = async (...) => ...`
  const arrowRegex =
    /(?:^|\n)\s*(?:export\s+)?(?:const|let)\s+(\w+)\s*[:=]\s*(?:async\s+)?(?:\([^)]*\)|\w+)\s*=>/g;
  // Match class declarations
  const classRegex = /(?:^|\n)\s*(?:export\s+)?(?:default\s+)?class\s+(\w+)/g;

  const seen = new Set<string>();

  const collect = (regex: RegExp, docType: DocumentType, prefix: string) => {
    let m: RegExpExecArray | null;
    while ((m = regex.exec(raw)) !== null) {
      const name = m[1];
      if (!name || seen.has(`${prefix}:${name}`)) continue;
      seen.add(`${prefix}:${name}`);

      const snippet = extractNamedBlock(raw, m.index, 30);

      out.push({
        id: `${repo}:${file.relativePath}:${prefix}:${name}`,
        repo,
        file_path: file.relativePath,
        doc_type: docType,
        anchor: name,
        content: truncate(snippet),
        metadata: { language: "typescript", name },
      });
    }
  };

  collect(fnRegex, "function", "fn");
  collect(arrowRegex, "function", "fn");
  collect(classRegex, "class", "cls");

  return out;
}

/* ───── Python ────────────────────────────────────────────────────── */

function extractPython(
  raw: string,
  file: WalkedFile,
  repo: string,
): ExtractedDocument[] {
  const out: ExtractedDocument[] = [];
  const seen = new Set<string>();

  const fnRegex = /^(?:async\s+)?def\s+(\w+)\s*\(/gm;
  const classRegex = /^class\s+(\w+)/gm;

  const collect = (regex: RegExp, docType: DocumentType, prefix: string) => {
    let m: RegExpExecArray | null;
    while ((m = regex.exec(raw)) !== null) {
      const name = m[1];
      if (!name || seen.has(`${prefix}:${name}`)) continue;
      seen.add(`${prefix}:${name}`);

      const snippet = extractNamedBlock(raw, m.index, 30);

      out.push({
        id: `${repo}:${file.relativePath}:${prefix}:${name}`,
        repo,
        file_path: file.relativePath,
        doc_type: docType,
        anchor: name,
        content: truncate(snippet),
        metadata: { language: "python", name },
      });
    }
  };

  collect(fnRegex, "function", "fn");
  collect(classRegex, "class", "cls");

  return out;
}

/* ───── package.json ──────────────────────────────────────────────── */

function extractPackageJson(
  raw: string,
  file: WalkedFile,
  repo: string,
): ExtractedDocument[] {
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(raw);
  } catch {
    return [];
  }

  const deps: Record<string, string> = {
    ...((pkg.dependencies as Record<string, string>) ?? {}),
    ...((pkg.devDependencies as Record<string, string>) ?? {}),
  };

  const out: ExtractedDocument[] = [];
  for (const [name, version] of Object.entries(deps)) {
    out.push({
      id: `${repo}:tech:${name}`,
      repo,
      file_path: file.relativePath,
      doc_type: "technology",
      anchor: name,
      content: `Uses "${name}" (${version}) from package.json in ${repo}`,
      metadata: {
        name,
        version,
        source: "package.json",
        ecosystem: "npm",
      },
    });
  }
  return out;
}

/* ───── Cargo.toml ────────────────────────────────────────────────── */

function extractCargoToml(
  raw: string,
  file: WalkedFile,
  repo: string,
): ExtractedDocument[] {
  // Super-light TOML parsing — just finds the [dependencies] block
  const out: ExtractedDocument[] = [];
  const depSection = /\[dependencies\]([\s\S]*?)(?:\n\[|\s*$)/.exec(raw);
  if (!depSection || !depSection[1]) return out;

  const lines = depSection[1].split("\n");
  for (const line of lines) {
    const m = /^\s*(\w[\w-]*)\s*=/.exec(line);
    if (!m || !m[1]) continue;
    const name = m[1];
    out.push({
      id: `${repo}:tech:${name}`,
      repo,
      file_path: file.relativePath,
      doc_type: "technology",
      anchor: name,
      content: `Uses Rust crate "${name}" from Cargo.toml in ${repo}`,
      metadata: { name, source: "Cargo.toml", ecosystem: "cargo" },
    });
  }
  return out;
}

/* ───── pyproject.toml ────────────────────────────────────────────── */

function extractPyProject(
  raw: string,
  file: WalkedFile,
  repo: string,
): ExtractedDocument[] {
  const out: ExtractedDocument[] = [];
  const depRegex = /(?:^|\n)\s*["']?([\w-]+)["']?\s*=/g;
  let m: RegExpExecArray | null;
  const section = /\[(?:project\.dependencies|tool\.poetry\.dependencies)\]([\s\S]*?)(?:\n\[|\s*$)/.exec(raw);
  if (!section || !section[1]) return out;

  while ((m = depRegex.exec(section[1])) !== null) {
    const name = m[1];
    if (!name || name === "python") continue;
    out.push({
      id: `${repo}:tech:${name}`,
      repo,
      file_path: file.relativePath,
      doc_type: "technology",
      anchor: name,
      content: `Uses Python package "${name}" from pyproject.toml in ${repo}`,
      metadata: { name, source: "pyproject.toml", ecosystem: "pypi" },
    });
  }
  return out;
}

/* ───── Test files ────────────────────────────────────────────────── */

function extractTestFile(
  raw: string,
  file: WalkedFile,
  repo: string,
): ExtractedDocument[] {
  // For now, index the file as a single "test_file" document.
  // Future: extract individual `it("...", ...)` or `test("...", ...)` blocks.
  if (raw.trim().length < 40) return [];

  const name = path.basename(file.relativePath, path.extname(file.relativePath));
  return [
    {
      id: `${repo}:${file.relativePath}:test`,
      repo,
      file_path: file.relativePath,
      doc_type: "test_file",
      anchor: name,
      content: truncate(raw),
      metadata: { file: file.relativePath },
    },
  ];
}

/* ───── Utilities ─────────────────────────────────────────────────── */

function truncate(s: string): string {
  if (s.length <= MAX_CONTENT_CHARS) return s;
  return s.slice(0, MAX_CONTENT_CHARS) + "\n... [truncated]";
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

/**
 * Given a position in the source, extract a snippet up to N lines forward.
 * This is a crude way to grab "the body" of a function without parsing.
 */
function extractNamedBlock(raw: string, startIndex: number, maxLines: number): string {
  const from = raw.lastIndexOf("\n", startIndex) + 1;
  const lines = raw.slice(from).split("\n");
  return lines.slice(0, maxLines).join("\n");
}
