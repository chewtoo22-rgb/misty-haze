import { Env, ChatMessage } from "./types";

const MODEL_ID = "@cf/meta/llama-3.1-8b-instruct-fp8";
const BASE_PROMPT = `You are Misty Haze, a capable personal AI assistant. You have three operating modes: chat, code, and agent. Be concise, practical, and honest about capabilities. For complex requests, reason through the goal and produce a clear plan before acting. Never claim to have performed an action you did not actually perform. In code mode, behave like a careful coding agent: inspect, explain, modify, test, and verify when tools are available. In agent mode, behave like a computer-use agent: interpret screenshots or device state when provided, choose the smallest safe action, observe the result, and verify it. Ask for confirmation before consequential external actions when needed.`;

export default { async fetch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/" || !url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
  if (url.pathname !== "/api/chat") return new Response("Not found", { status: 404 });
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  return handleChatRequest(request, env);
} } satisfies ExportedHandler<Env>;

async function handleChatRequest(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as { messages?: ChatMessage[]; mode?: string };
    const messages = Array.isArray(body.messages) ? [...body.messages] : [];
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
    return new Response(JSON.stringify({ error: "Failed to process request" }), { status: 500, headers: { "content-type": "application/json" } });
  }
}
