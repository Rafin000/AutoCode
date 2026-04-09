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

# 3. Link globally (so `auto-coder` works from anywhere)
npm link

# 4. Initialize config
auto-coder init

# 5. Register your first repo
auto-coder repo add my-project /path/to/my-project

# 6. Install auto-sync
auto-coder hook install my-project

# 7. Index it
auto-coder sync my-project

# 8. Ask it something
auto-coder ask "what projects have I used Neo4j in?"
```

## Commands (v1)

| Command | Purpose |
|---------|---------|
| `auto-coder init` | Create `~/.auto-coder/` and default config |
| `auto-coder config` | Show current config |
| `auto-coder repo add <name> <path>` | Register a repo |
| `auto-coder repo list` | List registered repos |
| `auto-coder repo remove <name>` | Unregister a repo |
| `auto-coder sync <name>` | Index or re-sync a single repo |
| `auto-coder sync --all` | Sync every registered repo |
| `auto-coder hook install <name>` | Install post-commit auto-sync |
| `auto-coder hook uninstall <name>` | Remove post-commit hook |
| `auto-coder ask "<question>"` | Ask a question about your work |
| `auto-coder interview "<question>"` | Answer in interview format |

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
./bin/auto-coder --help
```

## Milestone status

- [x] M1 — Monorepo scaffold + infra
- [ ] M2 — Config layer + types
- [ ] M3 — State DB (SQLite)
- [ ] M4 — Graph client (Neo4j)
- [ ] M5 — Vector client + embedder
- [ ] M6 — Sync pipeline (walker, extractor, processor)
- [ ] M7 — Git hook installer + cron helper
- [ ] M8 — `ask` and `interview` commands

## License

Personal project by @rafin — not licensed for redistribution.
