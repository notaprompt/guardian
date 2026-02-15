---
name: test-providers
description: Test all registered LLM providers (Claude CLI, Ollama, Fireworks, OpenAI, Moonshot) to verify connectivity, API keys, and response quality.
user_invocable: true
---

Test all registered LLM providers for Guardian.

## Steps

1. Read `lib/providers.js` to understand the current provider registry
2. Read `lib/forgeframe.js` to understand tier routing (quick/balanced/deep)
3. Check the Guardian SQLite database at `~/.guardian/guardian.db` for registered providers and models:
   - `SELECT * FROM providers;`
   - `SELECT * FROM models;`
4. For each provider, verify:
   - **Claude CLI**: Check if `claude` command is available in PATH
   - **Ollama** (localhost:11434): `curl http://localhost:11434/api/tags` to list models
   - **Fireworks**: Check if API key is stored via secure store
   - **OpenAI**: Check if API key is stored via secure store
   - **Moonshot**: Check if API key is stored via secure store
5. For providers with API access, send a minimal test prompt:
   ```
   curl -X POST <base_url>/v1/chat/completions \
     -H "Content-Type: application/json" \
     -d '{"model":"<model_id>","messages":[{"role":"user","content":"Respond with OK"}],"max_tokens":5}'
   ```

## Output

Report a status table:
| Provider | Status | Model | Tier | Notes |
|----------|--------|-------|------|-------|
