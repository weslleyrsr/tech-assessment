# Tech Assessment CLI — Design & Architecture

This document explains the design of the AI Code Analysis CLI so new contributors can quickly understand the codebase and make safe changes without breaking core logic.

Last updated: 2025-12-05

## 1. High-level Overview

The project is a small Bun-based command-line tool that:

1. Walks a target directory and collects a compact snapshot of readable files (text only, truncated per file and capped by count).
2. Builds a single prompt that embeds the snapshot and an optional user focus prompt.
3. Invokes an OpenAI chat model via LangChain inside a minimal LangGraph state machine to produce a human-readable analysis report.
4. Prints the report to stdout or writes it to a file.

Primary technologies:
- Runtime: Bun (TypeScript/ESM)
- LLM orchestration: LangChain + LangGraph
- Model provider: OpenAI (via `@langchain/openai`)

## 2. Repository Layout

```
index.ts           # Entry point; imports and runs src/cli.ts
src/cli.ts         # CLI implementation: arg parsing, repo walking, IO, graph invocation
src/graph.ts       # LangGraph graph and node; builds prompt and calls the model
README.md          # Usage instructions
docs/DESIGN.md     # This document
package.json       # Bun/TypeScript config and dependencies
tsconfig.json      # TypeScript configuration
.env               # (not committed) Place OPENAI_API_KEY here locally
```

## 3. Core Modules

### 3.1 `src/cli.ts`

Responsibilities:
- Parse CLI flags (`--dir`, `--prompt`, `--model`, `--temperature`, `--max-files`, `--max-chars`, `--out`).
- Walk the given directory (depth-first using an explicit stack) while skipping ignored folders and binary files.
- Sample file contents up to a character limit; build a compact summary string.
- Create and run the analysis graph with the summary and optional prompt.
- Output the report to stdout or write it to a file.

Key functions and invariants:
- `parseArgs(argv) -> Options`
  - Provides sensible defaults: current directory, `maxFiles=60`, `maxCharsPerFile=4000`.
  - Accepts a positional directory argument when the first non-flag token is present.
  - Invariant: options are fully resolved before use (paths via `resolve`).

- `walk(dir, { maxFiles })` (async generator)
  - Depth-first traversal implemented using a stack.
  - Skips directories listed in `DEFAULT_IGNORES` (e.g., `node_modules`, `.git`, `dist`).
  - Stops yielding files upon reaching `maxFiles`.
  - Invariant: never throws on unreadable directories/files; it continues gracefully.

- `readSample(file, maxChars) -> string | null`
  - Skips likely binary files by extension (see `BINARY_EXT`).
  - Reads UTF-8 and truncates to `maxChars`.
  - Invariant: returns `null` on errors or binaries, never throws.

- `summarizeRepo(dir, maxFiles, maxChars) -> string`
  - Builds a report-like concatenation of file excerpts, delimited by `--- BEGIN FILE: ... ---`.
  - Invariant: includes at most `maxFiles` readable files; never includes binary data.

- `main()`
  - Validates `OPENAI_API_KEY` presence via `Bun.env` or `process.env`.
  - Validates the target directory exists.
  - Orchestrates the steps and writes the result.
  - Invariant: exits with non-zero status on fatal misconfiguration (missing API key, missing directory).

Edge handling:
- All filesystem operations are wrapped to avoid throwing; errors cause a file or folder to be skipped.
- Path handling is Windows-friendly (uses Node `path` API); relative and absolute directories supported.

### 3.2 `src/graph.ts`

Responsibilities:
- Encapsulate the analysis behavior in a LangGraph `StateGraph` with a single `analyze` node.
- Build the prompt from a repository summary and optional user prompt.
- Call the OpenAI chat model through LangChain and return a plain-text report.

Key pieces:
- `AnalysisState` channels: `repoSummary`, `prompt`, `report`.
- `buildPrompt(summary, userPrompt?)` creates a bounded, self-contained instruction set for the model and appends the repository snapshot.
- `createAnalysisGraph({ modelName?, temperature? })`
  - Constructs `ChatOpenAI` using `model` and `temperature` (defaults: `gpt-4o-mini`, `0.2`).
  - Builds a `StateGraph` with a single node pipeline: `START -> analyze -> END`.
  - `analyzeNode` composes messages and extracts the text content.

Invariants:
- The graph must produce a `report` string; if the model returns structured content, we coerce to string by joining parts.
- The agent should only infer from the provided summary; prompt enforces this to reduce hallucinations.

### 3.3 `index.ts`

Minimal entry that imports `src/cli.ts` so `bun run index.ts` or using the module field loads the CLI.

## 4. Data Flow

1. CLI parses args to produce `Options`.
2. Directory walk yields file paths up to `maxFiles` while filtering ignored names.
3. For each file, `readSample` returns up to `maxChars` of UTF-8 text (or skips on binary/err).
4. `summarizeRepo` assembles the final snapshot string with per-file delimiters.
5. The graph is created with model parameters and invoked with `{ repoSummary, prompt }`.
6. The model returns content; graph returns `{ report }`.
7. CLI prints or writes the report per `--out`.

## 5. Configuration & Environment

- `OPENAI_API_KEY` must be provided via `.env` or the environment.
- CLI flags:
  - `--dir, -d <path>`: directory to analyze (default: current working directory).
  - `--prompt, -p <text>`: optional focus text appended to the prompt.
  - `--model, -m <name>`: OpenAI model (default: `gpt-4o-mini`).
  - `--temperature, -t <n>`: sampling temperature (default: `0.2`).
  - `--max-files <n>`: max readable files to include (default: `60`).
  - `--max-chars <n>`: max characters per file (default: `4000`).
  - `--out, -o <file>`: write report to a file instead of stdout.

## 6. Extension Points

- Add more nodes/tools to the graph:
  - Create additional nodes in `src/graph.ts` (e.g., `classify`, `detect_smells`, `summarize_api`).
  - Wire them into the `StateGraph` with `.addNode` and `.addEdge` transitions.
  - Preserve the `AnalysisState` shape or evolve it carefully (see “Core Logic & Safety”).

- Enhance repo sampling:
  - Add MIME sniffing to supplement extension-based binary detection.
  - Add per-language truncation strategies or sampling heuristics (e.g., function-by-function sampling).
  - Support custom ignore patterns via a config file (e.g., `.analysisignore`).

- Output formats:
  - Provide `--format md|json` and change `report` rendering logic accordingly.
  - For JSON, ensure downstream tools can consume the structure.

## 7. Core Logic & Safety (Invariants to Preserve)

When changing the code, keep these invariants intact to avoid breaking the core behavior:

1. Input bounding:
   - Always cap the number of files (`maxFiles`) and per-file size (`maxChars`).
   - Always skip binary files; never pass raw binary bytes to the model.

2. Fault tolerance:
   - Filesystem errors should not crash the CLI; skip problematic files and continue.
   - Missing API key or non-existent directory must exit early with a clear error message.

3. Prompt containment:
   - The model prompt must remain self-contained and reference only the provided snapshot.
   - Keep role separation (`system` + `user`) to reduce drift and hallucinations.

4. Deterministic defaults:
   - Stable defaults (model, temperature, counts) help reproducibility and predictable costs.

5. Windows/macOS/Linux paths:
   - Use Node’s `path` utilities for cross-platform correctness. Avoid manual string slicing when feasible.

## 8. Testing & Verification (Suggestions)

While this repo does not include automated tests, consider the following when adding changes:

- Unit tests:
  - `walk()` with a mocked filesystem to ensure ignores and caps work.
  - `readSample()` correctly identifies binaries and truncates text.
  - `buildPrompt()` produces expected structure and includes user prompt when present.

- Integration tests:
  - End-to-end run on a small fixture project with deterministic output (mock the model or use a stub).

- Manual checks:
  - Run `bun run src/cli.ts -h` for help output.
  - Verify error messages when `OPENAI_API_KEY` is unset.
  - Run against a small sample repo and inspect the printed report.

## 9. Performance & Cost Notes

- The largest contributors to latency/cost are:
  - The number of files included and the content length sent to the model.
  - The chosen model and temperature.
- Tune `--max-files`, `--max-chars`, and `--model` for your use case.

## 10. Security & Privacy

- The tool sends code excerpts to an external LLM provider. Ensure you have permission to upload that data.
- Consider adding a redaction layer to remove secrets or PII before building the prompt.
- Respect `.gitignore`-like patterns and allow project owners to configure additional ignores.

## 11. Limitations

- Single-pass analysis. There is no retrieval or multi-step reasoning beyond the prompt provided.
- Binary files are skipped purely by extension; some text files without extensions may be missed.
- No semantic search or chunk ranking; selection is naïve and order-dependent.

## 12. Onboarding Checklist for New Contributors

1. Install Bun and dependencies: `bun install`.
2. Create `.env` with `OPENAI_API_KEY`.
3. Run `bun run src/cli.ts -h` to see options.
4. Try analyzing this repo itself: `bun run src/cli.ts -d . -o report.md`.
5. Read `src/cli.ts` and `src/graph.ts` alongside this document.
6. If you extend the graph, keep invariants in Section 7.
7. If you change defaults or flags, update `README.md` and this document.

## 13. Glossary

- LangChain: A library for working with LLMs and building chains/agents.
- LangGraph: A library for building state graphs/workflows on top of LangChain.
- StateGraph: A directed graph of nodes that operate over a shared state object.
