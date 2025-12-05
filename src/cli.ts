#!/usr/bin/env bun
import { basename, join, resolve } from "path";
import { readdir } from "node:fs/promises";
import { statSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createAnalysisGraph } from "./graph";

type Options = {
  dir: string;
  prompt?: string;
  model?: string;
  temperature?: number;
  maxFiles: number;
  maxCharsPerFile: number;
  out?: string;
};

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    dir: process.cwd(),
    maxFiles: 60,
    maxCharsPerFile: 4000,
  } as Options;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => (i + 1 < argv.length ? argv[++i] : undefined);
    if (a === "--dir" || a === "-d") opts.dir = resolve(next() ?? ".");
    else if (a === "--prompt" || a === "-p") opts.prompt = next();
    else if (a === "--model" || a === "-m") opts.model = next();
    else if (a === "--temperature" || a === "-t") opts.temperature = Number(next());
    else if (a === "--max-files") opts.maxFiles = Number(next());
    else if (a === "--max-chars") opts.maxCharsPerFile = Number(next());
    else if (a === "--out" || a === "-o") opts.out = next();
    else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else if (!a.startsWith("-")) {
      opts.dir = resolve(a);
    }
  }
  return opts;
}

function printHelp() {
  const msg = `AI Code Analysis CLI (LangGraph + LangChain on Bun)

Usage:
  bun run src/cli.ts [options] [directory]

Options:
  -d, --dir <path>        Directory to analyze (default: current)
  -p, --prompt <text>     Extra guidance for the agent (e.g., focus on security)
  -m, --model <name>      OpenAI model (default: gpt-4o-mini)
  -t, --temperature <n>   Sampling temperature (default: 0.2)
      --max-files <n>     Cap the number of files read (default: 60)
      --max-chars <n>     Cap per-file characters read (default: 4000)
  -o, --out <file>        Save report to a file (default: prints to stdout)
  -h, --help              Show this help
`;
  console.log(msg);
}

const DEFAULT_IGNORES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".turbo",
  "coverage",
  ".venv",
  "venv",
  "out",
]);

const BINARY_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".pdf",
  ".zip",
  ".gz",
  ".tar",
  ".rar",
  ".7z",
  ".exe",
  ".dll",
  ".bin",
]);

async function* walk(dir: string, opts: { maxFiles: number }) {
  const stack = [dir];
  let count = 0;
  while (stack.length > 0 && count < opts.maxFiles) {
    const current = stack.pop()!;
    let dirents: string[] = [];
    try {
      dirents = await readdir(current);
    } catch {
      continue;
    }
    for (const name of dirents) {
      if (count >= opts.maxFiles) break;
      if (DEFAULT_IGNORES.has(name)) continue;
      const full = join(current, name);
      let s;
      try {
        s = statSync(full);
      } catch {
        continue;
      }
      if (s.isDirectory()) {
        stack.push(full);
      } else if (s.isFile()) {
        count++;
        yield full;
      }
    }
  }
}

function isBinaryByExt(path: string) {
  const i = path.lastIndexOf(".");
  if (i < 0) return false;
  return BINARY_EXT.has(path.slice(i).toLowerCase());
}

function readSample(file: string, maxChars: number): string | null {
  if (isBinaryByExt(file)) return null;
  try {
    const buf = readFileSync(file);
    const text = buf.toString("utf8");
    return text.slice(0, maxChars);
  } catch {
    return null;
  }
}

async function summarizeRepo(dir: string, maxFiles: number, maxChars: number): Promise<string> {
  const parts: string[] = [];
  parts.push(`Root: ${dir}`);
  let included = 0;
  for await (const file of walk(dir, { maxFiles })) {
    if (included >= maxFiles) break;
    const sample = readSample(file, maxChars);
    if (sample == null) continue;
    included++;
    const rel = file.startsWith(dir) ? file.slice(dir.length + (dir.endsWith("/") || dir.endsWith("\\") ? 0 : 1)) : file;
    parts.push(`\n--- BEGIN FILE: ${rel} ---\n${sample}\n--- END FILE: ${rel} ---`);
  }
  if (included === 0) parts.push("No readable source files found.");
  return parts.join("\n");
}

async function main() {
  const opts = parseArgs(Bun.argv);
  const apiKey = Bun.env.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("OPENAI_API_KEY is not set. Add it to .env or your environment.");
    process.exit(1);
  }
  const dir = resolve(opts.dir);
  if (!existsSync(dir)) {
    console.error(`Directory does not exist: ${dir}`);
    process.exit(1);
  }

  console.log(`Analyzing ${dir} ...`);
  const summary = await summarizeRepo(dir, opts.maxFiles, opts.maxCharsPerFile);

  const graph = createAnalysisGraph({ modelName: opts.model, temperature: opts.temperature });
  const result = await graph.invoke({ repoSummary: summary, prompt: opts.prompt });
  const report = result.report ?? "No report produced.";

  if (opts.out) {
    const outPath = resolve(opts.out);
    const outDir = outPath.slice(0, outPath.lastIndexOf("\\") > -1 ? outPath.lastIndexOf("\\") : outPath.lastIndexOf("/"));
    if (outDir && !existsSync(outDir)) mkdirSync(outDir, { recursive: true });
    writeFileSync(outPath, report, "utf8");
    console.log(`Report saved to ${outPath}`);
  } else {
    const title = `AI Analysis Report - ${basename(dir)}`;
    console.log(`\n===== ${title} =====\n`);
    console.log(report);
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
