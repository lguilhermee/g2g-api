# Changelog

All notable changes to `g2g-api` will be documented in this file.

## [0.1.0] - 2026-11-25

### Added
- **API v0.1** initial public release.
- **Official G2G Seller OpenAPI v2 client** (`open-api.g2g.com`) with canonical HMAC-SHA256 signing (`signG2GOpenApiRequest`).
- **Public Market Scanner** (`G2GClient.searchMarket`, `G2GClient.summarizeMarket`) via `sls.g2g.com/offer/search` with no authentication required.
- **Web Seller Session API** (`sls.g2g.com`) supporting raw JWT authentication, automatic `401` session renewal via `/user/refresh_access` + `onTokensRefreshed` hook, offer CRUD/bulk status updates, order listing, and the 3-step delivery workflow (`startWebDelivery` → `markWebOrderDelivering` → `updateWebDeliveredQty` + idempotent `advanceWebDeliveryToDelivering`).
- **Live Buyer Chat Bridge** combining `sls.g2g.com/chat` and SendBird v3 (WebSocket `LOGI` session key exchange + 25-minute cache + REST with WebSocket `MESG` fallback).
- **Inbound Webhook Verification** (`verifyG2GWebhookSignature`, `signG2GWebhook`, `createG2GWebhookMiddleware`) with constant-time HMAC-SHA256 checks and 5-minute replay protection.
- **Safe Order State Classifier** (`classifyG2GOrderState`, `allowsG2GDelivery`, `isRecentG2GOrder`).
- **Standalone Express REST Server** mounted at `/api/v0.1` (`createG2GServer`).
- Complete authentication and credential acquisition documentation (`docs/AUTHENTICATION.md`, `docs/CREDENTIALS.md`), runnable examples, and unit test suite.
