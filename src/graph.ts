import { ChatOpenAI } from "@langchain/openai";
import { StateGraph, END, START, type StateGraphArgs } from "@langchain/langgraph";

export type AnalysisState = {
  repoSummary: string;
  prompt?: string;
  report?: string;
};

function buildPrompt(summary: string, userPrompt?: string) {
  const base = `You are a senior code analysis agent.
You will analyze a codebase snapshot provided as a compact summary of files and selected excerpts.

Goals:
- Identify architecture, main technologies, and structure.
- Highlight potential issues, dead code, security risks, and obvious improvements.
- Suggest a prioritized action plan.

Constraints:
- Be concise but actionable.
- Quote filenames when referencing.
- Only infer from provided content.

Repository Summary:
-------------------
${summary}
`;
  if (userPrompt && userPrompt.trim().length > 0) {
    return `${base}\nUser focus: ${userPrompt.trim()}`;
  }
  return base;
}

export function createAnalysisGraph(args?: { modelName?: string; temperature?: number }) {
  const model = new ChatOpenAI({
    // "model" is the correct option name for @langchain/openai ChatOpenAI
    model: args?.modelName ?? "gpt-4o-mini",
    temperature: args?.temperature ?? 0.2,
    apiKey: (globalThis as any).Bun?.env?.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY,
  });

  const analyzeNode = async (state: AnalysisState): Promise<Partial<AnalysisState>> => {
    const prompt = buildPrompt(state.repoSummary, state.prompt);
    const res = await model.invoke([
      { role: "system", content: "You are a helpful, expert code reviewer and architect." },
      { role: "user", content: prompt },
    ]);
    const content = typeof res.content === "string" ? res.content : (res.content as any[]).map((c) => c.text ?? c).join("\n");
    return { report: String(content) };
  };

  const graph = new StateGraph<AnalysisState>({
    channels: {
      repoSummary: null as any,
      prompt: null as any,
      report: null as any,
    },
  } as unknown as StateGraphArgs<AnalysisState>)
    .addNode("analyze", analyzeNode)
    .addEdge(START, "analyze")
    .addEdge("analyze", END)
    .compile();

  return graph;
}
