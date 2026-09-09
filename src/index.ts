import { ChatMessage, Env } from "./types";

const CHAT_MODEL = "@cf/zai-org/glm-4.7-flash";
const NEMO_MODEL = "@cf/nvidia/nemotron-3-120b-a12b";

type AgentRole = "coder" | "reviewer" | "tester" | "planner";

const BASE_PROMPT = `You are Misty Haze, a capable personal AI assistant. You are an independent assistant and a standalone project.

Be concise, practical, and honest about capabilities. Never claim to have performed an action you did not actually perform. For complex requests, reason through the goal and produce a clear plan before acting.

Misty Haze is being built as a lightweight multi-agent assistant. Specialized agents are workers controlled by Misty; they are not separate products or replacements for Misty.

In CODE mode, behave like a professional software engineering agent. Analyze requirements, identify affected files, design the smallest robust change, consider edge cases, and provide verification steps. When repository tools are connected, use them rather than pretending to have access.

In AGENT mode, behave like a careful tool-using computer agent. Choose the smallest safe action, verify results, and never claim device control without an actual connected tool.

The long-term Misty Haze plan includes computer vision, PC use, Android use, coding, repository tools, testing, and autonomous repair loops. Clearly distinguish planned capabilities from connected capabilities.`;

const AGENT_PROMPTS: Record<AgentRole, string> = {
  coder: `You are NEMO, Misty Haze's primary coding agent. Focus on implementation quality, repository-aware reasoning, debugging, refactoring, tests, and production-ready code. Prefer small, reversible changes. When tools are available, inspect before modifying and verify after modifying.`,
  reviewer: `You are NEMO in REVIEWER role. Review proposed software changes aggressively but constructively. Look for correctness bugs, regressions, security issues, bad assumptions, missing tests, and unnecessary complexity. Return concrete fixes.`,
  tester: `You are NEMO in TESTER role. Design and reason through focused tests, build checks, failure diagnosis, and regression coverage. When given an error, identify the likely root cause and the smallest reliable repair.`,
  planner: `You are NEMO in PLANNER role. Turn a software goal into an ordered implementation plan with dependencies, acceptance criteria, verification steps, and rollback considerations. Avoid speculative architecture.`,
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/status" && request.method === "GET") {
      return json({
        name: "Misty Haze",
        status: "online",
        models: { chat: CHAT_MODEL, coding: NEMO_MODEL },
        capabilities: {
          chat: true,
          code: true,
          agent: true,
          vision: false,
          pcControl: false,
          androidControl: false,
          tools: false,
          github: false,
          autonomousRepair: false,
        },
        agents: [
          { id: "misty", role: "orchestrator", model: CHAT_MODEL, status: "active" },
          { id: "nemo", role: "coder", model: NEMO_MODEL, status: "active" },
          { id: "nemo-review", role: "reviewer", model: NEMO_MODEL, status: "ready" },
          { id: "nemo-test", role: "tester", model: NEMO_MODEL, status: "ready" },
          { id: "nemo-plan", role: "planner", model: NEMO_MODEL, status: "ready" },
        ],
      });
    }

    if (url.pathname === "/api/agents" && request.method === "GET") {
      return json({
        primary: "misty",
        coding: "nemo",
        agents: ["nemo", "nemo-review", "nemo-test", "nemo-plan"],
        execution: "Cloudflare Workers AI",
      });
    }

    if (url.pathname === "/" || !url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    if (url.pathname !== "/api/chat") return new Response("Not found", { status: 404 });
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    return handleChatRequest(request, env);
  },
} satisfies ExportedHandler<Env>;

async function handleChatRequest(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as {
      messages?: ChatMessage[];
      mode?: string;
      agentRole?: AgentRole;
    };

    const mode = body.mode === "code" || body.mode === "agent" ? body.mode : "chat";
    const agentRole: AgentRole = body.agentRole ?? (mode === "code" ? "coder" : "planner");
    const incoming = Array.isArray(body.messages) ? body.messages : [];

    const messages = incoming
      .filter((message) => message && (message.role === "user" || message.role === "assistant") && typeof message.content === "string")
      .slice(-24);

    const modePrompt = mode === "code"
      ? `Current mode: CODE. Route the coding work through NEMO.\n\n${AGENT_PROMPTS[agentRole]}`
      : mode === "agent"
        ? "Current mode: AGENT. Coordinate tools and computer-use tasks. Until real tools are connected, describe the required action without claiming it happened."
        : "Current mode: CHAT. Misty is the primary conversational orchestrator. Use the fast model for normal conversation and reasoning.";

    messages.unshift({ role: "system", content: `${BASE_PROMPT}\n\n${modePrompt}` });

    const model = mode === "code" || mode === "agent" ? NEMO_MODEL : CHAT_MODEL;
    const inputs = {
      messages,
      max_tokens: mode === "code" ? 3072 : 1536,
      stream: true,
    } satisfies AiTextGenerationInput & { stream: true };

    const stream = await env.AI.run<typeof model>(model, inputs);
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        "connection": "keep-alive",
        "x-misty-agent": mode === "code" || mode === "agent" ? "nemo" : "misty",
      },
    });
  } catch (error) {
    console.error("Misty Haze error:", error);
    return json({ error: "Failed to process request" }, 500);
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
