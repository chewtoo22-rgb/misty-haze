import { Env, ChatMessage } from "./types";

const MODEL_ID = "@cf/meta/llama-3.1-8b-instruct-fp8";
const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 12_000;
const MAX_TOTAL_CHARS = 30_000;
const BASE_PROMPT = `You are Misty Haze, a capable personal AI assistant. You have three operating modes: chat, code, and agent. Be concise, practical, and honest about capabilities. For complex requests, reason through the goal and produce a clear plan before acting. Never claim to have performed an action you did not actually perform. In code mode, behave like a careful coding agent: inspect, explain, modify, test, and verify when tools are available. In agent mode, behave like a computer-use agent: interpret screenshots or device state when provided, choose the smallest safe action, observe the result, and verify outcomes. Ask for confirmation before consequential external actions when needed.`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ status: "ok", service: "misty-haze" });
    }
    if (url.pathname === "/" || !url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (url.pathname !== "/api/chat") return new Response("Not found", { status: 404 });
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    return handleChatRequest(request, env);
  }
} satisfies ExportedHandler<Env>;

async function handleChatRequest(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as { messages?: unknown; mode?: unknown };
    if (!Array.isArray(body.messages)) {
      return Response.json({ error: "messages must be an array" }, { status: 400 });
    }
    if (body.messages.length > MAX_MESSAGES) {
      return Response.json({ error: `Too many messages; maximum is ${MAX_MESSAGES}` }, { status: 413 });
    }

    const messages: ChatMessage[] = [];
    let totalChars = 0;
    for (const message of body.messages) {
      if (!message || typeof message !== "object") {
        return Response.json({ error: "Invalid message" }, { status: 400 });
      }
      const candidate = message as { role?: unknown; content?: unknown };
      if (candidate.role !== "user" && candidate.role !== "assistant") {
        return Response.json({ error: "Invalid message role" }, { status: 400 });
      }
      if (typeof candidate.content !== "string" || candidate.content.length > MAX_MESSAGE_CHARS) {
        return Response.json({ error: `Message content must be text up to ${MAX_MESSAGE_CHARS} characters` }, { status: 400 });
      }
      totalChars += candidate.content.length;
      if (totalChars > MAX_TOTAL_CHARS) {
        return Response.json({ error: `Conversation is too large; maximum is ${MAX_TOTAL_CHARS} characters` }, { status: 413 });
      }
      messages.push({ role: candidate.role, content: candidate.content });
    }

    const mode = body.mode === "code" || body.mode === "agent" ? body.mode : "chat";
    const modePrompt = mode === "code"
      ? "Current mode: CODE. Focus on software engineering, repository analysis, implementation plans, debugging, testing, and precise code changes."
      : mode === "agent"
        ? "Current mode: AGENT. Focus on computer-use tasks. When device observations are available, use them to determine the next safe action and verify outcomes."
        : "Current mode: CHAT. Focus on useful conversation, research, explanation, and problem solving.";
    messages.unshift({ role: "system", content: `${BASE_PROMPT}\n\n${modePrompt}` });
    const inputs = { messages, max_tokens: 1536, stream: true } satisfies AiTextGenerationInput & { stream: true };
    const stream = await env.AI.run<typeof MODEL_ID>(MODEL_ID, inputs);
    return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", "connection": "keep-alive" } });
  } catch (error) {
    console.error("Misty Haze error:", error);
    return Response.json({ error: "Failed to process request" }, { status: 500 });
  }
}
