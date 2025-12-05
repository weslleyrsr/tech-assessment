# tech-assessment

AI-based technical assessment tools.

CLI: AI Code Analysis (Bun + LangGraph + LangChain)

This project includes a Bun-powered CLI that scans a directory (or the current one) and runs a simple LangGraph agent built with LangChain + OpenAI to produce a concise codebase analysis report.

Design & architecture docs
- See `docs/DESIGN.md` for a comprehensive overview of the architecture, data flow, core invariants, and extension points.

Prerequisites
- Bun v1.0+
- An OpenAI API key (`OPENAI_API_KEY`) in `.env` or your shell env

Install deps
```
bun install
```

Set your API key
```
echo OPENAI_API_KEY=sk-... >> .env
```

Usage
```
# Show help
bun run src/cli.ts -h

# Analyze current directory
bun run src/cli.ts

# Analyze a specific directory with a focus prompt and save to a file
bun run src/cli.ts -d ../some/project -p "focus on security and dead code" -o report.md

# Choose a model
bun run src/cli.ts -m gpt-4o-mini
```

NPM scripts
```
# Equivalent to bun run src/cli.ts
bun run analyze -- [options]
```

Notes
- Large/binary folders like `node_modules`, `.git`, `dist`, `build`, etc. are ignored by default.
- Each file is truncated to 4000 characters (configurable). Max files default to 60.
- You can adjust with `--max-files` and `--max-chars`.
- The agent is intentionally simple (single-node graph) so you can extend it with more tools/steps.
