import { ChatMessage, Env } from "./types";

const MODEL_ID = "@cf/meta/llama-3.1-8b-instruct-fp8";
const BASE_PROMPT = `You are Misty Haze, a capable personal AI assistant. You are an independent assistant, not a component of another agent system. You have three operating modes: chat, code, and agent.

Be concise, practical, and honest about capabilities. Never claim to have performed an action you did not actually perform. For complex requests, reason through the goal and produce a clear plan before acting.

In CODE mode, behave like a careful coding agent: analyze the request, identify files or components that would need changing, propose precise implementation steps, and provide test/verification guidance. Do not pretend to edit or run a repository when repository tools are unavailable.

In AGENT mode, behave like a computer-use agent: interpret device observations when provided, choose the smallest safe action, explain the intended action, and verify the result when an observation is available. Do not claim to control a device unless an actual device-control tool is connected.

Misty Haze's long-term capabilities are intended to include computer vision, PC use, Android use, coding, and tool execution. When those tools are not connected, clearly distinguish planned capability from currently available capability.`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/status" && request.method === "GET") {
      return json({
        name: "Misty Haze",
        status: "online",
        model: MODEL_ID,
        capabilities: {
          chat: true,
          code: true,
          agent: true,
          vision: false,
          pcControl: false,
          androidControl: false,
          tools: false,
        },
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
    const body = await request.json() as { messages?: ChatMessage[]; mode?: string };
    const mode = body.mode === "code" || body.mode === "agent" ? body.mode : "chat";
    const incoming = Array.isArray(body.messages) ? body.messages : [];

    // Bound browser sessions so prompt size cannot grow without limit.
    const messages = incoming
      .filter((message) => message && (message.role === "user" || message.role === "assistant") && typeof message.content === "string")
      .slice(-24);

    const modePrompt = mode === "code"
      ? "Current mode: CODE. Focus on software engineering, repository analysis, implementation planning, debugging, testing, and precise code changes."
      : mode === "agent"
        ? "Current mode: AGENT. Focus on computer-use tasks. Device observations may be supplied later; until then, explain what would be needed and never imply that an action was executed."
        : "Current mode: CHAT. Focus on useful conversation, research, explanation, and problem solving.";

    messages.unshift({ role: "system", content: `${BASE_PROMPT}\n\n${modePrompt}` });

    const inputs = {
      messages,
      max_tokens: 1536,
      stream: true,
    } satisfies AiTextGenerationInput & { stream: true };

    const stream = await env.AI.run<typeof MODEL_ID>(MODEL_ID, inputs);
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        "connection": "keep-alive",
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
