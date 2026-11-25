# Authentication Deep Dive (G2G API v0.1)

G2G.com uses **four distinct authentication mechanisms** depending on which backend surface you interact with. This document specifies each mechanism down to exact headers, signing strings, refresh payloads, and failure modes.

---

## 1. Official Seller OpenAPI v2 (`open-api.g2g.com`)

### Signing Algorithm

Every request requires an **HMAC-SHA256** digest computed over the concatenation of four strings (with no delimiter between them):

```text
canonical = urlPathWithoutQuery + apiKey + userId + timestamp
signature = lowercase_hex(HMAC_SHA256(key = apiSecret, message = canonical))
```

| Field | Format | Example |
| :--- | :--- | :--- |
| `urlPathWithoutQuery` | Leading `/` path only — **exclude** `?query=...` | `/v2/services/abc/brands` |
| `apiKey` | OpenAPI key from G2G Seller Portal | `your_api_key` |
| `userId` | Numeric G2G account ID as a string | `123456` |
| `timestamp` | 13-digit Unix epoch in milliseconds | `1730000000000` |

### Request Headers

```http
g2g-api-key: <apiKey>
g2g-userid: <userId>
g2g-timestamp: <timestamp>
g2g-signature: <signature>
Content-Type: application/json
Accept: application/json
```

### Response Envelope

Successful responses return HTTP `200` and a JSON envelope where `code` is `"20000001"` (or starts with `"200"`):

```json
{
  "request_id": "req_...",
  "code": "20000001",
  "message": "OK",
  "payload": {}
}
```

### TypeScript Reference

```ts
import { signG2GOpenApiRequest } from "g2g-api";

const headers = signG2GOpenApiRequest({
  urlPath: "/v2/products?service_id=abc&brand_id=def",
  apiKey: process.env.G2G_API_KEY!,
  apiSecret: process.env.G2G_API_SECRET!,
  userId: process.env.G2G_USER_ID!,
});
```

---

## 2. Public Market Scanner (`sls.g2g.com/offer/search`)

No credentials are required. Send a standard `GET` request with a browser-like `User-Agent` and `Accept: application/json`:

```http
GET https://sls.g2g.com/offer/search?seo_term=wow-gold&page_size=24&page=1&sort=lowest_price&currency=USD&country=US&include_localization=0&v=v2
```

Optional query parameters:
- `q` — free-text keyword filter
- `filter_attr` — attribute filter in `collection_id:dataset_id` format
- `group` — `0` for ungrouped individual offers, `1` for grouped offers

---

## 3. Web Seller Session API (`sls.g2g.com`)

Normal G2G seller accounts that do not have full OpenAPI write permissions (or need access to web-only endpoints such as `start_deliver`, `mark_as_delivering`, `delivered_qty`, and chat) authenticate via the web seller JWT.

### Critical Header Format

`sls.g2g.com` expects the **raw JWT** in the `Authorization` header — **do NOT prepend `Bearer `**:

```http
Authorization: eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...
Origin: https://www.g2g.com
Referer: https://www.g2g.com/
Content-Type: application/json
Accept: application/json
```

`G2GClient` automatically calls `normalizeWebJwt()` to strip any accidental `Bearer ` prefix.

### Automatic Session Renewal (`401` Refresh Flow)

Short-lived access JWTs expire periodically. When `G2GClient.webRequest()` encounters `HTTP 401` and either `refreshToken` or `longLivedToken` is configured, it automatically posts:

```http
POST https://sls.g2g.com/user/refresh_access
Content-Type: application/json
Origin: https://www.g2g.com
Referer: https://www.g2g.com/

{
  "user_id": "<sellerId>",
  "refresh_token": "<refreshToken>",
  "active_device_token": "<activeDeviceToken>",
  "long_lived_token": "<longLivedToken>"
}
```

If G2G returns a new `payload.access_token` (and optionally rotated refresh/device tokens), `G2GClient`:
1. Updates its in-memory credentials.
2. Invokes `onTokensRefreshed({ accessToken, refreshToken, longLivedToken, activeDeviceToken })` so your app can save them to disk/DB/vault.
3. Retries the original HTTP call once.

---

## 4. Live Buyer Chat (`sls.g2g.com/chat` + SendBird v3)

G2G's buyer chat is hosted on **SendBird** under G2G's public application ID:

```text
SendBird App ID : 34201740-152E-401E-AD8F-5C72EEABA386
SendBird WS     : wss://ws-34201740-152E-401E-AD8F-5C72EEABA386.sendbird.com/
SendBird REST   : https://api-34201740-152E-401E-AD8F-5C72EEABA386.sendbird.com/v3
```

### Two-Step Session Acquisition

1. **Fetch SendBird Access Token** using your G2G Web JWT:
   ```http
   POST https://sls.g2g.com/chat/user
   Authorization: <rawWebJwt>

   { "user_id": "<sellerId>" }
   ```
   Extract `payload.session_tokens[0].session_token`.

2. **Exchange Access Token for SendBird `Session-Key`** via WebSocket:
   Connect to:
   ```text
   wss://ws-34201740-152E-401E-AD8F-5C72EEABA386.sendbird.com/?p=JS&pv=Chrome&sv=4.14.0&ai=34201740-152E-401E-AD8F-5C72EEABA386&user_id=<sellerId>&access_token=<sessionToken>&Request-Sent-Timestamp=<nowMs>
   ```
   Wait for the first frame prefixed with `LOGI`:
   ```text
   LOGI{"key":"<sessionKey>", ...}
   ```
   Close the WebSocket and cache `sessionKey` (default TTL: 25 minutes).

3. **Call SendBird v3 REST** with `Session-Key: <sessionKey>`:
   - List DM channels: `GET /users/:sellerId/my_group_channels?...`
   - Read messages: `GET /group_channels/:channelUrl/messages?...`
   - Send message: `POST /group_channels/:channelUrl/messages` (falls back to WebSocket `MESG{...}\n` if REST is rejected)
   - Mark read: `PUT /group_channels/:channelUrl/messages/mark_as_read`

   If SendBird returns HTTP `401` or error code `400302` / `400303` (expired session key), `G2GClient` automatically refreshes the `Session-Key` and retries once.

---

## 5. Inbound Webhook Verification (`HMAC-SHA256`)

When G2G sends a webhook `POST` to your registered callback URL, it includes:
- `g2g-timestamp`: 13-digit Unix timestamp in milliseconds
- `g2g-signature`: 64-character hex HMAC-SHA256 digest

Verification formula:

```text
canonical = registeredWebhookUrl + userId + g2gTimestampHeader
expected  = HMAC_SHA256(key = webhookSecret, message = canonical)
valid     = timingSafeEqual(expected, hexToBytes(g2gSignatureHeader))
            AND abs(nowMs - Number(g2gTimestampHeader)) <= 300_000
```

> **Important:** `registeredWebhookUrl` must match the **exact** URL string configured in the G2G Seller OpenAPI dashboard (scheme, host, path, and trailing slash if any).
