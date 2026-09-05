# AutoCode

> A personal AI that knows your code, understands your work, and answers questions grounded in your real projects — and can implement, review, and ship features into those projects on its own.

AutoCode indexes your GitHub repositories into a local knowledge base (graph + vectors)
and lets you query it with natural language. It started as a personal assistant for
answering recruiter questions and reviewing your own past work — it has since grown
into an autonomous feature-implementation agent, a rules engine that learns your
codebase's conventions, and a general-purpose automation/publishing pipeline built
on the same knowledge base.

## What it can do

- Register repos via config and index them into Neo4j (graph) + Qdrant (vectors)
- Auto-sync on local commits (git hook), on a schedule (cron), or via polling (`watch`)
- Ask natural-language questions grounded in your real code, with cited sources
- Answer interview-style questions in STAR format using only your real projects
- **Autonomously plan, implement, and open a PR for a feature** — spawns the `claude`
  CLI to do the actual coding, while AutoCode's own code handles branching, committing,
  pushing, and PR creation
- **Learn from reviewer feedback** — rework instructions on a feature become permanent
  "anti-pattern" rules that get enforced on every future feature in that repo
- **Detect cross-service dependencies** between two registered repos, so it warns you
  before a change in one might break another
- **Run arbitrary YAML pipelines** (retrieve → generate → human-review → publish) —
  the same engine that powers `ask`/`interview` also drives a content-marketing
  pipeline that drafts and publishes posts to Bluesky/Buffer
- Sync Jira tickets alongside feature status (optional, env-configured)
- Serve an HTTP API locally, or deploy a matching API to Cloudflare Workers

**Not yet wired up:**

- A web UI
- Auto-triggering rework from GitHub PR review webhooks (the webhook receiver exists
  and logs these events, but doesn't act on them yet)

## Stack

| Component | Technology |
|-----------|------------|
| Language | TypeScript + Node 20 |
| CLI | Commander |
| Build | tsup + tsx |
| Graph DB | Neo4j 5 Community (Docker) |
| Vector DB | Qdrant (Docker) |
| State DB | SQLite (`better-sqlite3`) |
| Embeddings | `@xenova/transformers` (local, 384-dim) |
| LLM | Claude or OpenAI (configurable) |
| Coding agent | `claude` CLI, spawned as a subprocess |
| Local HTTP API | Hono (`@hono/node-server`) |
| Hosted API (optional) | Cloudflare Workers + D1 + Vectorize (see `api/`) |
| Git | `simple-git` (read), `git`/`gh` CLI (write, via subprocess) |
| Config | cosmiconfig + YAML |

## Setup

```bash
# 1. Start infra
docker compose up -d

# 2. Install deps + build
npm install
npm run build

# 3. Link globally (so `autocode` works from anywhere)
npm link

# 4. Initialize config
autocode init

# 5. Register your first repo
autocode repo add my-project /path/to/my-project

# 6. Install auto-sync
autocode hook install my-project

# 7. Index it
autocode sync my-project

# 8. Ask it something
autocode ask "what projects have I used Neo4j in?"
```

`feature create` additionally requires the `claude` CLI installed and logged in
(`claude login`), and `gh` (GitHub CLI, authenticated) if you want PRs opened
automatically — pass `--no-pr` to skip that.

## Commands

### Setup & repos

| Command | Purpose |
|---------|---------|
| `autocode init` | Create `~/.autocode/` and default config |
| `autocode config` | Show current config |
| `autocode repo add <name> <path>` | Register a repo |
| `autocode repo list` | List registered repos |
| `autocode repo remove <name>` | Unregister a repo |

### Sync & knowledge base

| Command | Purpose |
|---------|---------|
| `autocode sync <name>` / `--all` / `--full` | Index or re-sync repo(s) |
| `autocode hook install/uninstall/list <name>` | Manage git post-commit auto-sync |
| `autocode watch [--interval N] [-r repo]` | Poll for new commits and auto-sync |
| `autocode cron` | Run every pipeline flagged `trigger: cron` |
| `autocode knowledge test-graph` / `test-vectors` / `stats` | Smoke-test and inspect the stores |

### Ask your own work

| Command | Purpose |
|---------|---------|
| `autocode ask "<question>" [-r repo] [-k topK]` | Ask a question, grounded + cited |
| `autocode interview "<question>"` | Answer in STAR format for interview prep |

### Autonomous feature development

| Command | Purpose |
|---------|---------|
| `autocode feature create -t <title> -d <desc> [-r repo] [--no-plan] [--no-pr]` | Plan (default) or implement a feature directly |
| `autocode feature implement <id>` | Implement a feature that's `plan_ready` |
| `autocode feature plan <id>` | View a feature's saved plan |
| `autocode feature test-context -t -d` | Preview the exact prompt Claude would get, no side effects |
| `autocode feature rework <id> -i "<instructions>"` | Apply reviewer feedback to an implemented feature |
| `autocode feature list [-r repo]` / `status <id>` | List or inspect features |
| `autocode feature approve <id>` | Mark a merged feature approved + re-sync knowledge from the diff |

### Rules engine

| Command | Purpose |
|---------|---------|
| `autocode rules add --type hard_rule\|soft_rule\|anti_pattern --rule "..." --scope all\|<repo>` | Add a rule |
| `autocode rules list` / `get <id>` / `enable\|disable <id>` / `delete <id>` | Manage rules |

### Cross-service linking

| Command | Purpose |
|---------|---------|
| `autocode link <repo1> <repo2> [--skip-scan]` | Detect cross-service dependencies via Claude, write edges to Neo4j |

### Workflow engine (pipelines & skills)

| Command | Purpose |
|---------|---------|
| `autocode run <pipeline> -i key=value` | Run a YAML pipeline from `~/.autocode/pipelines/` |
| `autocode run list` / `show <id>` / `resume <id>` / `cancel <id>` / `pipelines` | Manage pipeline runs |
| `autocode skill list` / `show <name>` / `validate` | Manage reusable LLM personas (`~/.autocode/skills/`) |

Seeded by `autocode init`: `qa` and `interview` pipelines (back `ask`/`interview`),
and `marketing-mock` / `marketing-bluesky` / `marketing-buffer` — draft → review →
publish pipelines for social content, grounded in your indexed work.

### API & serving

| Command | Purpose |
|---------|---------|
| `autocode serve [-p port]` | Start the local HTTP API (features/rules/knowledge/webhooks) |

A separate Cloudflare Worker package (`api/`) mirrors this API on D1 + Vectorize,
deployed via GitHub Actions on push to `main` — see `api/wrangler.toml`.

## Architecture

```
=== PART 1 — SYNC (one-time setup, run once per repo) ===

   Your repos (real code)
        │
        ▼
   SYNC (walks files, splits into chunks)
        │
        ├──▶ SQLite   — remembers state (what's synced, feature status, rules)
        ├──▶ Neo4j    — remembers connections (repo→uses→tech, cross-repo calls)
        └──▶ Qdrant   — remembers meaning (searchable code/doc snippets)


=== PART 2 — FEATURE DEVELOPMENT (repeats, once per feature) ===

   RETRIEVER (asks all three stores above:
              "what's relevant, connected, and allowed?" —
              this includes any rules saved from earlier features)
        │
        ▼
   "feature create"
        │
        ▼
   Claude writes a plan
        │
        ▼
   Claude writes the code
        │
        ▼
   AutoCode runs: branch → commit → push → PR
        │
        ├── you give rework feedback ──▶ Claude edits the code again
        │                                     │
        │                                     ▼
        │                                AutoCode commits + pushes again
        │                                loops back up
        │
        ▼
   You open GitHub and click "Merge"
        │
        ▼
   "feature approve"
        │
        ├──▶ re-syncs the knowledge base (SQLite/Neo4j/Qdrant)
        │       from what was actually merged — feeds back into Part 1
        │
        └──▶ every rework instruction from this feature gets
              saved as a permanent rule, which the RETRIEVER
              above will include the next time a feature is created
```

`ask`/`interview` follow the same Part 1 → Retriever path as feature development,
but hand the retrieved context to an LLM for a text answer instead of spawning
`claude` to write code.

## Development

```bash
# Run directly without building (uses tsx)
npm run dev -- --help

# Build once, then run
npm run build
./bin/autocode --help
```

## Auto-sync

autocode ships with three complementary sync triggers so the knowledge
base stays fresh without you remembering to run anything.

### 1. Git hook (instant, local)

```bash
autocode hook install <repo-name>
```

Installs a `post-commit` hook into the repo. Every commit triggers a
background `autocode sync <name> --quiet` run. Usually finishes in
under a second thanks to diff-based incremental sync.

To see which repos have hooks installed:

```bash
autocode hook list
```

To remove:

```bash
autocode hook uninstall <repo-name>
```

The hook is marker-guarded — uninstall only touches hooks that
autocode installed, not any foreign hooks you may have.

### 2. Daily cron (catches everything the hook misses)

The git hook only fires on local commits. If you pull teammate work,
commit from another machine, or merge via the GitHub UI, the hook
doesn't run. A daily cron catches these cases:

```cron
# Add to `crontab -e`
0 7 * * * /path/to/autocode sync --all > /tmp/autocode.log 2>&1
```

Incremental sync is cheap, so running daily has negligible cost.

### 3. Watch (polling, no crontab needed)

```bash
autocode watch --interval 60
```

Polls `git rev-parse HEAD` on an interval and re-syncs when it moves —
a lighter alternative to cron if you'd rather leave a terminal open
than touch your crontab.

## Feature lifecycle in detail

```
pending → planning → plan_ready → implementing → ready_for_review → approved
                                                        │
                                                        └─▶ failed (any stage)
```

- **Plan-first by default**: `feature create` spawns Claude once to investigate
  the codebase and write a markdown plan — no code yet. `feature implement`
  then spawns Claude a second time to follow that plan. Pass `--no-plan` to
  skip straight to implementation.
- **Claude never touches git.** It's prompt-constrained to only write files
  and a result JSON; AutoCode's own code does branch creation, staging,
  committing, pushing, and `gh pr create`.
- **Rework loops on the same branch.** `feature rework <id> -i "..."` spawns
  Claude again with your instructions, pushes to the same branch, and the
  existing PR updates automatically. Can repeat multiple rounds.
- **Rules are learned, not just applied.** Every rework instruction across a
  feature's lifetime is saved as an `anti_pattern` rule the moment you run
  `feature approve` — not before. If a feature is abandoned before approval,
  that feedback is never persisted as a rule.

## Milestone status

- [x] M1 — Monorepo scaffold + infra
- [x] M2 — Config layer + types
- [x] M3 — State DB (SQLite)
- [x] M4 — Graph client (Neo4j)
- [x] M5 — Vector client + embedder
- [x] M6 — Sync pipeline (walker, extractor, processor)
- [x] M7 — Git hook installer + cron helper
- [x] M8 — `ask` and `interview` commands — **v1 complete**
- [x] Rules engine (hard rules, soft rules, anti-patterns, self-reinforcement)
- [x] Cross-service linking (`autocode link`)
- [x] Feature lifecycle (plan → implement → PR → rework → approve)
- [x] Generic workflow engine + skills, with `ask`/`interview` ported onto it
- [x] Content-marketing pipelines + Bluesky/Buffer publishers
- [x] Jira integration
- [x] Local HTTP API (`serve`) + matching Cloudflare Worker API (`api/`)

## License

Personal project by @rafin — not licensed for redistribution.
