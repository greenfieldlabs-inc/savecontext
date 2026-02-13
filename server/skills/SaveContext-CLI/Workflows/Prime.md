# Prime Workflow

Read-only context aggregation for full project awareness.

## When to Use

- At conversation start when resuming complex projects
- When an agent needs full project state in a single call
- Before making architectural decisions requiring broad context
- When injecting context into agent system prompts

## Quick Use

```bash
sc prime
```

Returns session state, high-priority items, decisions, active issues, memory, and a command reference — all in one call.

## Output Modes

### Terminal (default)
Colored, human-readable output:
```bash
sc prime
```

### Compact (agent injection)
Markdown formatted for system prompts:
```bash
sc prime --compact
```

### JSON (programmatic)
Structured JSON for parsing:
```bash
sc prime --json
```

## Smart Mode

Relevance-ranked context selection with token-budget packing. Scores every item and selects the optimal subset for injection into a token-limited context window.

```bash
sc prime --smart --compact                    # Ranked context, 4000 token budget
sc prime --smart --compact --budget 2000      # Tighter budget
sc prime --smart --compact --query "auth"     # Boost auth-related items
sc prime --smart --compact --decay-days 7     # Aggressive recency bias
sc prime --smart --json                       # JSON with scoring stats
```

**Scoring:** `temporal_decay * priority_weight * category_weight * semantic_boost`

| Factor | Values |
|--------|--------|
| Temporal decay | Exponential: today=1.0, 7d=0.71, 14d=0.5, 28d=0.25 |
| Priority | high=3.0x, normal=1.0x, low=0.5x |
| Category | decision=2.0x, reminder=1.5x, progress=1.0x, note=0.5x |
| Semantic boost | 0.5x-2.5x (only with `--query`, uses embedding similarity) |

**MMR diversity:** After scoring, near-duplicate items are penalized so the output covers more ground.

**Token packing:** Items are packed greedily into the budget. Smaller items can fill gaps left by skipped large ones.

## With Transcripts

Parse Claude Code session transcripts for additional context:

```bash
sc prime --transcript
sc prime --transcript --transcript-limit 10
sc prime --smart --compact --transcript       # Smart mode + transcripts
```

This reads JSONL transcript files from `~/.claude/projects/` and extracts conversation summaries, providing richer project history.

## What It Returns

### Standard mode (`--compact`)

| Section | Contents |
|---------|----------|
| Session | Name, status, description, branch, created/updated times |
| Git | Branch, uncommitted changes |
| Context | High-priority items, decisions, reminders, recent progress (fixed limits) |
| Issues | Active + ready issues |
| Memory | Project commands, configs, notes |
| Transcripts | Recent conversation summaries (if `--transcript`) |
| Commands | Quick reference cheatsheet |

### Smart mode (`--smart --compact`)

| Section | Contents |
|---------|----------|
| Stats | Budget used/total, items selected/total, MMR applied, query boosted |
| Context | Single ranked list with scores, sorted by relevance (within budget) |
| Issues | Active + ready issues |
| Memory | Project commands, configs, notes |
| Transcripts | Recent conversation summaries (if `--transcript`) |
| Commands | Quick reference cheatsheet |

## Examples

```bash
# Standard: fixed-limit category buckets
sc prime --compact

# Smart: ranked by relevance, budget-aware
sc prime --smart --compact

# Smart with tight budget (only most important items)
sc prime --smart --compact --budget 1000

# Smart boosting a topic (items about auth rank higher)
sc prime --smart --compact --query "authentication"

# JSON with scoring stats (for programmatic use)
sc prime --smart --json
```

## Compared to Other Commands

| Command | Purpose |
|---------|---------|
| `sc status` | Quick session stats (item count, categories) |
| `sc prime --compact` | Full context dump with fixed-limit buckets |
| `sc prime --smart` | Relevance-ranked context within token budget |
| `sc compaction` | Creates checkpoint + summary (mutates state) |

**Key difference:** `sc prime` is purely read-only. It never creates checkpoints or modifies the database.
