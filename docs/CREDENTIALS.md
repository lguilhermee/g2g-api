# How to Get Your G2G Credentials

This guide walks you through obtaining every credential supported by `g2g-api` v0.1 — depending on which features you need, you only have to set up the sections relevant to you.

| If you want to… | Credentials needed |
| :--- | :--- |
| **Scan public competitor prices** (`searchMarket`) | None! Works out of the box. |
| **Use Official Seller OpenAPI v2** (store, catalog, offers, orders, codes) | `G2G_API_KEY`, `G2G_API_SECRET`, `G2G_USER_ID` |
| **Verify inbound G2G webhooks** | `G2G_WEBHOOK_SECRET`, `G2G_WEBHOOK_URL`, `G2G_USER_ID` |
| **Manage offers/orders via Web Seller API & Live Buyer Chat** | `G2G_SELLER_ID`, `G2G_WEB_TOKEN` *(plus optional refresh tokens for automatic renewal)* |

---

## Part A — Official Seller OpenAPI v2 Credentials

Use this for `G2G_API_KEY`, `G2G_API_SECRET`, `G2G_USER_ID`, and `G2G_WEBHOOK_SECRET`.

1. Sign in to your verified G2G Seller account at **[https://www.g2g.com](https://www.g2g.com)**.
2. Open the **Seller Portal / OpenAPI Settings** (typically under **Account Settings → API / OpenAPI** or **Seller Dashboard → OpenAPI**).
3. Request or enable **Seller OpenAPI v2** access if not already active on your account.
4. Once enabled, copy:
   - **API Key** → `G2G_API_KEY`
   - **API Secret** → `G2G_API_SECRET`
   - **User ID** (numeric ID shown on your G2G profile / API portal) → `G2G_USER_ID`
5. *(Optional — Webhooks)* In the same OpenAPI dashboard:
   - Enter your public HTTPS callback URL (e.g. `https://your-domain.example.com/api/v0.1/webhook`) → `G2G_WEBHOOK_URL`
   - Copy the generated **Webhook Secret** → `G2G_WEBHOOK_SECRET`

> **Tip:** Your `G2G_USER_ID` and `G2G_SELLER_ID` are the same numeric ID. You can also see it in any `sls.g2g.com/user/<ID>/info` network request while signed in.

---

## Part B — Web Seller Session & Live Chat Credentials

The Web Seller API (`sls.g2g.com`) and SendBird Buyer Chat bridge use the session tokens issued when you log in to `www.g2g.com` in your browser.

### Step 1: Extract `G2G_WEB_TOKEN` and `G2G_SELLER_ID`

1. Open **[https://www.g2g.com](https://www.g2g.com)** in Chrome, Edge, or Brave and sign in to your seller account.
2. Press **`F12`** (or `Ctrl+Shift+I` / `Cmd+Option+I`) to open **DevTools**.
3. Click the **Network** tab, enable **Fetch/XHR**, and type `sls.g2g.com` in the filter box.
4. Navigate to your **Manage Offers** or **Sold Orders** page so the browser triggers authenticated requests.
5. Click any `sls.g2g.com` request (for example `/user/<id>/info` or `/v3/offer/seller/<id>/my_offers`).
6. Under **Request Headers**, copy the full value of **`Authorization`** (it starts with `eyJ...` and has **no** `Bearer ` prefix):
   - Paste it into `G2G_WEB_TOKEN`.
7. Copy the numeric `<id>` from the request URL (e.g. `/user/123456/info` → `123456`):
   - Paste it into `G2G_SELLER_ID`.

### Step 2: Extract Refresh Tokens (Recommended for Automatic Renewal)

Because `G2G_WEB_TOKEN` is a short-lived JWT, adding your refresh tokens allows `G2GClient` to automatically call `POST /user/refresh_access` whenever a `401` occurs — keeping long-running bots and servers authenticated without manual intervention.

1. In DevTools, open the **Application** tab → **Local Storage** → `https://www.g2g.com` (and also check **Cookies** / **Network** responses from `/user/refresh_access` or login).
2. Look for keys or JSON fields containing:
   - `refresh_token` → `G2G_REFRESH_TOKEN`
   - `long_lived_token` → `G2G_LONG_LIVED_TOKEN`
   - `active_device_token` → `G2G_ACTIVE_DEVICE_TOKEN`
3. Alternatively, keep the **Network** tab open with `refresh_access` in the filter box — the next time G2G refreshes your tab's session, inspect the **Payload** of `POST https://sls.g2g.com/user/refresh_access` and copy all four fields (`user_id`, `refresh_token`, `active_device_token`, `long_lived_token`).

### Step 3: Persist Rotated Tokens (Important!)

When `G2GClient` refreshes a session, G2G may rotate the refresh token. In production code, always pass `onTokensRefreshed` so you save the latest tokens:

```ts
const client = new G2GClient({
  web: {
    sellerId: process.env.G2G_SELLER_ID!,
    webToken: process.env.G2G_WEB_TOKEN!,
    refreshToken: process.env.G2G_REFRESH_TOKEN,
    longLivedToken: process.env.G2G_LONG_LIVED_TOKEN,
    activeDeviceToken: process.env.G2G_ACTIVE_DEVICE_TOKEN,
    onTokensRefreshed: async (tokens) => {
      // Save tokens.accessToken, tokens.refreshToken, tokens.longLivedToken, tokens.activeDeviceToken
      // to your database, secret manager, or encrypted config file.
    },
  },
});
```

---

## Part C — Verify Your Setup

Once your `.env` is populated, start the server and run the built-in diagnostics endpoint:

```bash
npm run dev:server
```

In a second terminal:

```bash
# Public market scan (no auth required)
curl "http://localhost:4080/api/v0.1/market/search?seoTerm=wow-gold&pageSize=3"

# Credential diagnostics (checks OpenAPI v2 + Web Seller JWT)
curl -X POST http://localhost:4080/api/v0.1/diagnostics
```

If you set `SERVER_API_TOKEN` in `.env`, include `-H "Authorization: Bearer <SERVER_API_TOKEN>"`.

---

## Troubleshooting

| Symptom | Cause | Fix |
| :--- | :--- | :--- |
| `401` on OpenAPI v2 | Clock drift, wrong `userId`, or query string included in signature | Ensure system clock is synced via NTP; confirm `G2G_USER_ID` is numeric; always sign path without `?query`. |
| `401` on Web Seller API | Expired `G2G_WEB_TOKEN` or missing refresh tokens | Add `G2G_REFRESH_TOKEN`, `G2G_LONG_LIVED_TOKEN`, and `G2G_ACTIVE_DEVICE_TOKEN`, or re-copy fresh tokens from DevTools. |
| `403` / `Access Denied` on OpenAPI write calls | Standard seller accounts often have read-only OpenAPI access | Use the Web Seller API (`createWebOffer`, `updateWebOffer`, `listMyWebOrders`) instead. |
| `SendBird LOGI rejected` | Expired web token or mismatched `sellerId` | Verify `G2G_SELLER_ID` matches the `user_id` inside your JWT (check with `decodeWebJwtClaims(token)`). |
| `401` on `/api/v0.1/webhook` | `G2G_WEBHOOK_URL` mismatch or stale timestamp | Verify `G2G_WEBHOOK_URL` matches the exact URL registered in the G2G dashboard (including `https://` and exact path). |

---

## Security Best Practices

- **Never commit `.env`** or paste JWTs/secrets into public issues or logs.
- Treat `G2G_WEB_TOKEN` and `G2G_LONG_LIVED_TOKEN` as **full account credentials** — encrypt them at rest (e.g. AES-256-GCM or a cloud secrets manager).
- Always set `SERVER_API_TOKEN` if exposing the REST server beyond `localhost`.
- If you suspect a token leaked, log out of all sessions on G2G and rotate your OpenAPI secret immediately.
