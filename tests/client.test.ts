import assert from "node:assert/strict";
import test from "node:test";
import { G2GClient } from "../src/client.js";

test("G2GClient.webRequest automatically refreshes on 401 and invokes onTokensRefreshed", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let refreshedAccess = "";

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/user/refresh_access")) {
      return new Response(
        JSON.stringify({
          payload: {
            access_token: "fresh-jwt-token",
            refresh_token: "fresh-refresh-token",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    calls += 1;
    const authHeader = (init?.headers as Record<string, string>)?.Authorization;
    if (calls === 1) {
      assert.equal(authHeader, "stale-jwt-token");
      return new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 });
    }

    assert.equal(authHeader, "fresh-jwt-token");
    return new Response(JSON.stringify({ payload: { username: "demo_seller" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const client = new G2GClient({
      web: {
        webToken: "Bearer stale-jwt-token",
        sellerId: "123456",
        refreshToken: "old-refresh-token",
        onTokensRefreshed: (tokens) => {
          refreshedAccess = tokens.accessToken;
        },
      },
    });

    const info = (await client.getWebUserInfo()) as { payload?: { username?: string } };
    assert.equal(info.payload?.username, "demo_seller");
    assert.equal(refreshedAccess, "fresh-jwt-token");
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
