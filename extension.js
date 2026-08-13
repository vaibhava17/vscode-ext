const vscode = require("vscode");

const PROVIDERS = {
  anthropic: {
    label: "Anthropic Claude",
    kind: "anthropic",
    baseUrl: "https://api.anthropic.com",
    models: ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5"],
    needsKey: true,
  },
  openai: {
    label: "OpenAI GPT",
    kind: "openai",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "o4-mini"],
    needsKey: true,
  },
  gemini: {
    label: "Google Gemini",
    kind: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    models: ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-2.5-pro", "gemini-1.5-pro"],
    needsKey: true,
  },
  deepseek: {
    label: "DeepSeek",
    kind: "openai",
    baseUrl: "https://api.deepseek.com",
    models: ["deepseek-chat", "deepseek-reasoner"],
    needsKey: true,
  },
  xai: {
    label: "xAI Grok",
    kind: "openai",
    baseUrl: "https://api.x.ai/v1",
    models: ["grok-3", "grok-3-mini", "grok-2-latest"],
    needsKey: true,
  },
  mistral: {
    label: "Mistral",
    kind: "openai",
    baseUrl: "https://api.mistral.ai/v1",
    models: ["mistral-large-latest", "mistral-small-latest", "codestral-latest"],
    needsKey: true,
  },
  groq: {
    label: "Groq",
    kind: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"],
    needsKey: true,
  },
  openrouter: {
    label: "OpenRouter",
    kind: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    models: ["anthropic/claude-sonnet-4.6", "openai/gpt-4o", "google/gemini-2.0-flash-001", "deepseek/deepseek-chat"],
    needsKey: true,
  },
  ollama: {
    label: "Ollama (local)",
    kind: "openai",
    baseUrl: "http://localhost:11434/v1",
    models: ["llama3.2", "llama3.1", "qwen2.5-coder", "codellama", "mistral"],
    needsKey: false,
  },
  custom: {
    label: "Custom (OpenAI-compatible)",
    kind: "openai",
    baseUrl: "",
    models: [],
    needsKey: true,
  },
};

const MAX_DIFF_CHARS = 60000;

const PROMPT =
  "Write a single-line git commit message (max 72 chars, imperative mood, " +
  "conventional commit style like `feat: ...` or `fix: ...`) for this diff. " +
  "Reply with ONLY the commit message, no quotes, no explanation.\n\n";

function secretKey(provider) {
  return `aiCommit.apiKey.${provider}`;
}

function getConfig() {
  const cfg = vscode.workspace.getConfiguration("aiCommit");
  return {
    provider: cfg.get("provider", "anthropic"),
    model: cfg.get("model", "claude-opus-4-8"),
    baseUrl: cfg.get("baseUrl", ""),
  };
}

async function setup(context) {
  const providerId = await vscode.window.showQuickPick(
    Object.entries(PROVIDERS).map(([id, p]) => ({ label: p.label, id })),
    { placeHolder: "Select AI provider" }
  );
  if (!providerId) return;
  const provider = PROVIDERS[providerId.id];

  let model;
  if (provider.models.length) {
    const pick = await vscode.window.showQuickPick(
      [...provider.models, "$(edit) Enter custom model..."],
      { placeHolder: "Select model" }
    );
    if (!pick) return;
    model = pick.startsWith("$(edit)")
      ? await vscode.window.showInputBox({ prompt: "Model ID" })
      : pick;
  } else {
    model = await vscode.window.showInputBox({ prompt: "Model ID" });
  }
  if (!model) return;

  const cfg = vscode.workspace.getConfiguration("aiCommit");
  await cfg.update("provider", providerId.id, vscode.ConfigurationTarget.Global);
  await cfg.update("model", model, vscode.ConfigurationTarget.Global);

  if (providerId.id === "custom" || providerId.id === "ollama") {
    const baseUrl = await vscode.window.showInputBox({
      prompt: "Base URL (OpenAI-compatible)",
      value: provider.baseUrl || "http://localhost:11434/v1",
    });
    if (baseUrl === undefined) return;
    await cfg.update("baseUrl", baseUrl, vscode.ConfigurationTarget.Global);
  }

  if (provider.needsKey) {
    const key = await vscode.window.showInputBox({
      prompt: `API key for ${provider.label}`,
      password: true,
      ignoreFocusOut: true,
    });
    if (key) await context.secrets.store(secretKey(providerId.id), key);
  }

  vscode.window.showInformationMessage(
    `AI Commit: ${provider.label} / ${model} configured ✓`
  );
}

function getRepo() {
  const gitExt = vscode.extensions.getExtension("vscode.git");
  if (!gitExt) throw new Error("Git extension not found");
  const git = gitExt.exports.getAPI(1);
  if (!git.repositories.length) throw new Error("No git repository open");
  return git.repositories[0];
}

async function getDiff(repo) {
  let diff = await repo.diff(true); // staged
  if (!diff || !diff.trim()) diff = await repo.diff(false); // unstaged
  if (!diff || !diff.trim()) {
    // untracked-only case: list new files as context
    const untracked = repo.state.workingTreeChanges
      .map((c) => c.uri.fsPath)
      .join("\n");
    if (untracked) diff = "New untracked files:\n" + untracked;
  }
  if (!diff || !diff.trim()) throw new Error("No changes found to commit");
  if (diff.length > MAX_DIFF_CHARS) {
    diff = diff.slice(0, MAX_DIFF_CHARS) + "\n\n[diff truncated]";
  }
  return diff;
}

async function callAnthropic(baseUrl, apiKey, model, prompt) {
  const res = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const block = (data.content || []).find((b) => b.type === "text");
  return block ? block.text : "";
}

async function callOpenAICompat(baseUrl, apiKey, model, prompt) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

async function callGemini(baseUrl, apiKey, model, prompt) {
  const res = await fetch(
    `${baseUrl}/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 300 },
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

function cleanMessage(text) {
  let msg = (text || "").trim();
  // strip markdown fences / quotes / thinking tags if a model adds them
  msg = msg.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  msg = msg.replace(/^```[a-z]*\n?|```$/g, "").trim();
  msg = msg.replace(/^["'`]|["'`]$/g, "").trim();
  return msg.split("\n")[0].trim();
}

async function generate(context) {
  try {
    const { provider: providerId, model, baseUrl: baseUrlOverride } = getConfig();
    const provider = PROVIDERS[providerId];
    if (!provider) throw new Error(`Unknown provider: ${providerId}`);

    let apiKey = await context.secrets.get(secretKey(providerId));
    if (provider.needsKey && !apiKey) {
      const choice = await vscode.window.showWarningMessage(
        `No API key set for ${provider.label}.`,
        "Set up now"
      );
      if (choice === "Set up now") await setup(context);
      apiKey = await context.secrets.get(secretKey(providerId));
      if (provider.needsKey && !apiKey) return;
    }

    const baseUrl = (baseUrlOverride && baseUrlOverride.trim()) || provider.baseUrl;
    if (!baseUrl) throw new Error("Base URL not set (aiCommit.baseUrl)");

    const repo = getRepo();
    const diff = await getDiff(repo);
    const prompt = PROMPT + diff;

    const message = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.SourceControl,
        title: "Generating commit message...",
      },
      async () => {
        if (provider.kind === "anthropic")
          return callAnthropic(baseUrl, apiKey, model, prompt);
        if (provider.kind === "gemini")
          return callGemini(baseUrl, apiKey, model, prompt);
        return callOpenAICompat(baseUrl, apiKey, model, prompt);
      }
    );

    const clean = cleanMessage(message);
    if (!clean) throw new Error("Model returned an empty message");
    repo.inputBox.value = clean;
  } catch (err) {
    vscode.window.showErrorMessage(`AI Commit: ${err.message}`);
  }
}

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand("aiCommit.setup", () => setup(context)),
    vscode.commands.registerCommand("aiCommit.generate", () => generate(context))
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
