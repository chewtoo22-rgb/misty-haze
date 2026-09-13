/**
 * Runtime bindings for Misty Haze.
 */
export interface Env {
  AI: Ai;
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  /** GitHub fine-grained token with repo contents/actions permissions. */
  GITHUB_TOKEN?: string;
  /** Optional repo override; defaults to chewtoo22-rgb/misty-haze. */
  GITHUB_REPO?: string;
  /** Optional default branch; defaults to main. */
  GITHUB_DEFAULT_BRANCH?: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
