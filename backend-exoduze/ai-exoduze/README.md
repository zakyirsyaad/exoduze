# AI Exoduze

Internal AI decision module used by the backend market-join flow.

This package owns:

- Prompt construction
- Canonical JSON hashing
- Heuristic decision fallback
- OpenAI decision provider
- OpenRouter decision provider
- Decision response validation

The backend keeps the DB-backed orchestration for joining markets and syncing on-chain state.
