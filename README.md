# AI Commit Message

Generate git commit messages from your diff using any major AI provider.

## Supported providers

- Anthropic Claude
- OpenAI GPT
- Google Gemini
- DeepSeek
- xAI Grok
- Mistral
- Groq
- OpenRouter
- Ollama (local, no API key)
- Any custom OpenAI-compatible endpoint

## Usage

1. Run command: **AI Commit: Select Provider, Model & API Key** (Cmd+Shift+P)
2. Pick provider → pick model → paste API key (stored securely in VS Code SecretStorage)
3. Click the ✨ sparkle button in the Source Control title bar
4. Commit message appears in the message box — edit if needed, commit

Staged changes are used first; falls back to unstaged changes.
