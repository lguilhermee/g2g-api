# Contributing to `g2g-api`

Contributions, bug reports, and documentation improvements are welcome!

## Development Setup

```bash
npm install
npm run typecheck
npm run build
npm test
```

## Guidelines

1. **Never commit real credentials, API keys, seller IDs, or session tokens.** Use synthetic test fixtures only.
2. Keep the core SDK game-agnostic so it works for every category and game listed on G2G.
3. Add or update unit tests under `tests/` when changing signing, webhook verification, order state classification, or HTTP client behavior.
4. Run `npm run typecheck && npm run build && npm test` before opening a pull request.
