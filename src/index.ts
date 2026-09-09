import { ChatMessage, Env } from "./types";

const CHAT_MODEL = "@cf/zai-org/glm-4.7-flash";
const NEMO_MODEL = "@cf/nvidia/nemotron-3-120b-a12b";
const DEFAULT_REPO = "chewtoo22-rgb/misty-haze";
const DEFAULT_BRANCH = "main";

type AgentRole = "coder" | "reviewer" | "tester" | "planner";
type ToolCall = { name: string; arguments?: Record<string, unknown> };

const BASE_PROMPT = `You are Misty Haze, a capable personal AI assistant. You are an independent assistant and a standalone project.

Be concise, practical, and honest about capabilities. Never claim to have performed an action you did not actually perform. For complex requests, reason through the goal and produce a clear plan before acting.

Misty Haze is a lightweight multi-agent assistant. Specialized agents are workers controlled by Misty; they are not separate products or replacements for Misty.

In CODE mode, NEMO is a repository-aware coding agent. Inspect the repository before making recommendations, ground answers in actual files when repository tools are available, and never pretend an edit or test happened when it did not.

In AGENT mode, use available tools when possible. Never claim device control without an actual connected device tool.`;

const AGENT_PROMPTS: Record<AgentRole, string> = {
  coder: `You are NEMO, Misty Haze's primary coding agent. Focus on implementation quality, repository-aware reasoning, debugging, refactoring, tests, and production-ready code. Inspect relevant files before proposing changes.`,
  reviewer: `You are NEMO in REVIEWER role. Review software changes aggressively but constructively. Look for correctness bugs, regressions, security issues, bad assumptions, missing tests, and unnecessary complexity. Ground review in repository files.`,
  tester: `You are NEMO in TESTER role. Diagnose builds and tests, identify likely root causes, and propose focused regression coverage.`,
  planner: `You are NEMO in PLANNER role. Turn a software goal into an ordered implementation plan with dependencies, acceptance criteria, verification steps, and rollback considerations.`,
};

const GITHUB_TOOLS = [
  { name: "github_list_files", description: "List files in the configured GitHub repository. Use before coding to understand project structure.", parameters: { type: "object", properties: { path: { type: "string" }, branch: { type: "string" } }, required: [] } },
  { name: "github_read_file", description: "Read a text file from the configured GitHub repository.", parameters: { type: "object", properties: { path: { type: "string" }, branch: { type: "string" } }, required: ["path"] } },
];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const github = Boolean(env.GITHUB_TOKEN);
    if (url.pathname === "/api/status" && request.method === "GET") return json({ name: "Misty Haze", status: "online", models: { chat: CHAT_MODEL, coding: NEMO_MODEL }, capabilities: { chat: true, code: true, agent: true, vision: false, pcControl: false, androidControl: false, tools: github, github, autonomousRepair: false }, github: { configured: github, repository: env.GITHUB_REPO ?? DEFAULT_REPO, defaultBranch: env.GITHUB_DEFAULT_BRANCH ?? DEFAULT_BRANCH }, agents: [{ id: "misty", role: "orchestrator", model: CHAT_MODEL, status: "active" }, { id: "nemo", role: "coder", model: NEMO_MODEL, status: "active" }, { id: "nemo-review", role: "reviewer", model: NEMO_MODEL, status: "ready" }, { id: "nemo-test", role: "tester", model: NEMO_MODEL, status: "ready" }, { id: "nemo-plan", role: "planner", model: NEMO_MODEL, status: "ready" }] });
    if (url.pathname === "/api/agents" && request.method === "GET") return json({ primary: "misty", coding: "nemo", agents: ["nemo", "nemo-review", "nemo-test", "nemo-plan"], tools: GITHUB_TOOLS.map((tool) => tool.name) });
    if (url.pathname === "/" || !url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (url.pathname !== "/api/chat") return new Response("Not found", { status: 404 });
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    return handleChatRequest(request, env);
  },
} satisfies ExportedHandler<Env>;

async function handleChatRequest(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as { messages?: ChatMessage[]; mode?: string; agentRole?: AgentRole };
    const mode = body.mode === "code" || body.mode === "agent" ? body.mode : "chat";
    const agentRole: AgentRole = body.agentRole ?? (mode === "code" ? "coder" : "planner");
    const messages: ChatMessage[] = (Array.isArray(body.messages) ? body.messages : []).filter((message) => message && (message.role === "user" || message.role === "assistant") && typeof message.content === "string").slice(-24);
    const modePrompt = mode === "code" ? `Current mode: CODE. Route the work through NEMO.\n\n${AGENT_PROMPTS[agentRole]}` : mode === "agent" ? `Current mode: AGENT. ${AGENT_PROMPTS[planner]}` : "Current mode: CHAT. Misty is the primary conversational orchestrator.";
    messages.unshift({ role: "system", content: `${BASE_PROMPT}\n\n${modePrompt}\n\nGitHub read tools are available only when GITHUB_TOKEN is configured.` });
    const model = mode === "code" || mode === "agent" ? NEMO_MODEL : CHAT_MODEL;
    if ((mode === "code" || mode === "agent") && env.GITHUB_TOKEN) {
      for (let step = 0; step < 4; step++) {
        const result = await env.AI.run(model, { messages, tools: GITHUB_TOOLS, max_tokens: 3072 });
        const toolCalls = extractToolCalls(result);
        const responseText = extractResponseText(result);
        if (!toolCalls.length) return streamModel(env, model, messages.concat(responseText ? [{ role: "assistant", content: responseText }] : []), 3072);
        if (responseText) messages.push({ role: "assistant", content: responseText });
        for (const call of toolCalls) messages.push({ role: "assistant", content: JSON.stringify({ tool: call.name, result: await executeReadTool(call, env) }) });
      }
    }
    return streamModel(env, model, messages, mode === "code" ? 3072 : 1536);
  } catch (error) { console.error("Misty Haze error:", error); return json({ error: "Failed to process request" }, 500); }
}

async function streamModel(env: Env, model: string, messages: ChatMessage[], max_tokens: number): Promise<Response> {
  const stream = await env.AI.run(model, { messages, max_tokens, stream: true });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", "connection": "keep-alive", "x-misty-agent": model === NEMO_MODEL ? "nemo" : "misty" } });
}

function extractToolCalls(result: unknown): ToolCall[] {
  const value = result as { tool_calls?: unknown };
  if (!Array.isArray(value.tool_calls)) return [];
  return value.tool_calls.flatMap((item) => { if (!item || typeof item !== "object") return []; const call = item as { name?: unknown; arguments?: unknown; function?: { name?: unknown; arguments?: unknown } }; const name = typeof call.name === "string" ? call.name : typeof call.function?.name === "string" ? call.function.name : ""; const raw = call.arguments ?? call.function?.arguments ?? {}; let args: Record<string, unknown> = {}; if (typeof raw === "string") { try { args = JSON.parse(raw); } catch {} } else if (raw && typeof raw === "object") args = raw as Record<string, unknown>; return name ? [{ name, arguments: args }] : []; });
}

function extractResponseText(result: unknown): string { const value = result as { response?: unknown; choices?: Array<{ message?: { content?: unknown } }> }; if (typeof value.response === "string") return value.response; const content = value.choices?.[0]?.message?.content; return typeof content === "string" ? content : ""; }

async function executeReadTool(call: ToolCall, env: Env): Promise<unknown> {
  const args = call.arguments ?? {}; const repo = env.GITHUB_REPO ?? DEFAULT_REPO; const branch = typeof args.branch === "string" && args.branch ? args.branch : (env.GITHUB_DEFAULT_BRANCH ?? DEFAULT_BRANCH); const token = env.GITHUB_TOKEN; if (!token) return { ok: false, error: "GITHUB_TOKEN is not configured" };
  if (call.name === "github_list_files") { const path = typeof args.path === "string" ? args.path : ""; return githubRequest(`https://api.github.com/repos/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`, token); }
  if (call.name === "github_read_file") { const path = String(args.path ?? ""); const data = await githubRequest(`https://api.github.com/repos/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`, token); if (!data.ok || !data.content) return data; return { ok: true, path, sha: data.sha, content: decodeBase64(data.content) }; }
  return { ok: false, error: "Unknown tool" };
}

async function githubRequest(url: string, token: string): Promise<any> { const response = await fetch(url, { headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2026-03-10" } }); const text = await response.text(); let data: any = {}; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; } if (!response.ok) return { ok: false, status: response.status, error: data.message ?? "GitHub request failed" }; return { ok: true, ...data }; }
function decodeBase64(value: string): string { const binary = atob(value.replace(/\n/g, "")); const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0)); return new TextDecoder().decode(bytes); }
function json(data: unknown, status = 200): Response { return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } }); }
