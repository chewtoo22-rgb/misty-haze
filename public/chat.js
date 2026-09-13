const chatMessages = document.getElementById("messages");
const userInput = document.getElementById("input");
const sendButton = document.getElementById("send");
const capability = document.getElementById("capability");
const statusText = document.getElementById("statusText");
const newChat = document.getElementById("newChat");
const newChatMobile = document.getElementById("newChatMobile");

let mode = "chat";
let isProcessing = false;
let chatHistory = [];

const modeInfo = {
  chat: { label: "Cloud AI", placeholder: "What do you want me to do?" },
  code: { label: "Coding agent", placeholder: "Describe the code you want me to build or fix..." },
  agent: { label: "Computer agent", placeholder: "Tell me what you want Misty Haze to do..." },
};

document.querySelectorAll(".mode").forEach((button) => {
  button.addEventListener("click", () => setMode(button.dataset.mode));
});

document.querySelectorAll(".quick button").forEach((button) => {
  button.addEventListener("click", () => {
    userInput.value = button.dataset.prompt;
    userInput.dispatchEvent(new Event("input"));
    userInput.focus();
  });
});

function setMode(nextMode) {
  if (!modeInfo[nextMode]) return;
  mode = nextMode;
  document.querySelectorAll(".mode").forEach((button) => button.classList.toggle("active", button.dataset.mode === mode));
  capability.textContent = modeInfo[mode].label;
  userInput.placeholder = modeInfo[mode].placeholder;
}

function resetChat() {
  chatHistory = [];
  chatMessages.innerHTML = `<div class="welcome" id="welcome"><h1>Misty Haze</h1><p>One assistant. Three modes. Built to grow into vision, coding, and device control.</p><div class="quick"><button data-prompt="Explain what you can do.">What can you do?</button><button data-prompt="Help me build something.">Build something</button><button data-prompt="Help me troubleshoot a problem.">Troubleshoot</button></div></div>`;
  chatMessages.querySelectorAll(".quick button").forEach((button) => button.addEventListener("click", () => {
    userInput.value = button.dataset.prompt;
    userInput.dispatchEvent(new Event("input"));
    userInput.focus();
  }));
}

newChat?.addEventListener("click", resetChat);
newChatMobile?.addEventListener("click", resetChat);

userInput.addEventListener("input", () => {
  userInput.style.height = "auto";
  userInput.style.height = Math.min(userInput.scrollHeight, 170) + "px";
});
userInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});
sendButton.addEventListener("click", sendMessage);

async function loadStatus() {
  try {
    const response = await fetch("/api/status", { cache: "no-store" });
    if (!response.ok) throw new Error("status unavailable");
    const data = await response.json();
    statusText.textContent = data.status === "online" ? "Online" : "Unavailable";
  } catch {
    statusText.textContent = "Offline";
  }
}

function addMessage(role, text) {
  document.getElementById("welcome")?.remove();
  const row = document.createElement("div");
  row.className = `message ${role}`;
  if (role === "assistant") {
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = "🌫️";
    row.appendChild(avatar);
  }
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  row.appendChild(bubble);
  chatMessages.appendChild(row);
  scrollToBottom();
  return bubble;
}

function addActivity(text) {
  const el = document.createElement("div");
  el.className = "activity";
  const label = mode === "agent" ? "👁 Agent" : mode === "code" ? "💻 Code" : "🧠 Misty";
  el.innerHTML = `<b>${label}</b> · ${escapeHtml(text)}`;
  chatMessages.appendChild(el);
  scrollToBottom();
}

function escapeHtml(value) {
  return value.replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[char] || char));
}

function scrollToBottom() {
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function sendMessage() {
  const message = userInput.value.trim();
  if (!message || isProcessing) return;

  isProcessing = true;
  sendButton.disabled = true;
  userInput.disabled = true;
  addMessage("user", message);
  userInput.value = "";
  userInput.style.height = "auto";
  if (mode !== "chat") addActivity(mode === "code" ? "Preparing the coding task..." : "Preparing the computer-use task...");

  chatHistory.push({ role: "user", content: message });
  const bubble = addMessage("assistant", "");

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: chatHistory, mode }),
    });
    if (!response.ok || !response.body) throw new Error("Request failed");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parsed = consume(buffer);
      buffer = parsed.buffer;
      for (const data of parsed.events) {
        if (data === "[DONE]") continue;
        try {
          const json = JSON.parse(data);
          const part = typeof json.response === "string" ? json.response : json.choices?.[0]?.delta?.content || "";
          if (part) {
            text += part;
            bubble.textContent = text;
            scrollToBottom();
          }
        } catch { /* wait for the next complete SSE event */ }
      }
    }

    if (!text) text = "Misty Haze returned no text.";
    bubble.textContent = text;
    chatHistory.push({ role: "assistant", content: text });
  } catch (error) {
    bubble.textContent = "I couldn't complete that request. The Misty Haze Worker may be unavailable.";
  } finally {
    isProcessing = false;
    sendButton.disabled = false;
    userInput.disabled = false;
    userInput.focus();
  }
}

function consume(buffer) {
  const events = [];
  const normalized = buffer.replace(/\r/g, "");
  let rest = normalized;
  let index;
  while ((index = rest.indexOf("\n\n")) !== -1) {
    const raw = rest.slice(0, index);
    rest = rest.slice(index + 2);
    const data = raw.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
    if (data) events.push(data);
  }
  return { events, buffer: rest };
}

loadStatus();
