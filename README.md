# AutoCode

> A personal AI that knows your code, understands your work, and answers questions grounded in your real projects.

AutoCode indexes your GitHub repositories into a local knowledge base (graph + vectors)
and lets you query it with natural language. Built as a personal assistant for answering
recruiter questions, reviewing your own past work, and eventually automating content and
code tasks on top of the same foundation.

## v1 scope — Job assistant

Ships in v1:

- Register repos via config
- Index them into Neo4j (graph) + Qdrant (vectors)
- Auto-sync on local commits (git hook) and nightly (cron)
- Ask natural-language questions grounded in your real code
- Interview-style answers with concrete project examples

**Not in v1** (planned for later):

- Social media posting
- Code generation / feature implementation
- Web UI
- Webhook receiver

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
| Git | `simple-git` |
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

## Commands (v1)

| Command | Purpose |
|---------|---------|
| `autocode init` | Create `~/.autocode/` and default config |
| `autocode config` | Show current config |
| `autocode repo add <name> <path>` | Register a repo |
| `autocode repo list` | List registered repos |
| `autocode repo remove <name>` | Unregister a repo |
| `autocode sync <name>` | Index or re-sync a single repo |
| `autocode sync --all` | Sync every registered repo |
| `autocode hook install <name>` | Install post-commit auto-sync |
| `autocode hook uninstall <name>` | Remove post-commit hook |
| `autocode ask "<question>"` | Ask a question about your work |
| `autocode interview "<question>"` | Answer in interview format |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    INPUTS                               │
│  GitHub repos · CV · Blog posts · Your prompts          │
└──────────────────────────┬──────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────┐
│                INGESTION & SYNC                         │
│  Git hook · Daily cron · Manual sync                    │
│            ↓                                            │
│  Diff since last_synced_commit → extract → upsert       │
└──────────────────────────┬──────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────┐
│                 KNOWLEDGE BASE                          │
│  Neo4j (graph)  Qdrant (vectors)  SQLite (state)        │
└──────────────────────────┬──────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────┐
│                   AGENT CORE                            │
│  Retriever → Prompt builder → LLM (Claude/GPT)          │
└──────────────────────────┬──────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────┐
│                   CAPABILITIES                          │
│  ask  ·  interview  ·  (future: marketing, coder)       │
└─────────────────────────────────────────────────────────┘
```

## Development

```bash
# Run directly without building (uses tsx)
npm run dev -- --help

# Build once, then run
npm run build
./bin/autocode --help
```

## Auto-sync

autocode ships with two complementary sync triggers so the knowledge
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

## Milestone status

- [x] M1 — Monorepo scaffold + infra
- [x] M2 — Config layer + types
- [x] M3 — State DB (SQLite)
- [x] M4 — Graph client (Neo4j)
- [x] M5 — Vector client + embedder
- [x] M6 — Sync pipeline (walker, extractor, processor)
- [x] M7 — Git hook installer + cron helper
- [x] M8 — `ask` and `interview` commands — **v1 complete**

## License

Personal project by @rafin — not licensed for redistribution.
