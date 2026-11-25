import crypto from "node:crypto";

export interface G2GOpenApiSignParams {
  /** Request path, with or without query string (query string is stripped automatically). */
  urlPath: string;
  /** G2G Seller OpenAPI key (`g2g-api-key`). */
  apiKey: string;
  /** G2G Seller OpenAPI secret (HMAC-SHA256 key). */
  apiSecret: string;
  /** Numeric G2G user ID (`g2g-userid`). */
  userId: string;
  /** Optional 13-digit Unix timestamp in milliseconds (defaults to `Date.now()`). */
  timestamp?: string;
}

export type G2GOpenApiSignedHeaders = {
  "g2g-api-key": string;
  "g2g-userid": string;
  "g2g-signature": string;
  "g2g-timestamp": string;
  "Content-Type": string;
  Accept: string;
};

/**
 * Compute the exact G2G Seller OpenAPI v2 HMAC-SHA256 signature headers.
 *
 * Canonical string:
 *   `canonical = cleanUrlPath + apiKey + userId + timestamp`
 *
 * Where `cleanUrlPath` is the request path WITHOUT query parameters (e.g. `/v2/offers`).
 */
export function signG2GOpenApiRequest(params: G2GOpenApiSignParams): G2GOpenApiSignedHeaders {
  const timestamp = params.timestamp || String(Date.now());
  const normalizedPath = params.urlPath.startsWith("/") ? params.urlPath : `/${params.urlPath}`;
  const cleanPath = normalizedPath.split("?")[0];
  const canonical = `${cleanPath}${params.apiKey}${params.userId}${timestamp}`;
  const signature = crypto
    .createHmac("sha256", params.apiSecret)
    .update(canonical)
    .digest("hex");

  return {
    "g2g-api-key": params.apiKey,
    "g2g-userid": params.userId,
    "g2g-signature": signature,
    "g2g-timestamp": timestamp,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

/**
 * Strip any accidental `Bearer ` prefix from a G2G web session JWT.
 *
 * IMPORTANT: `sls.g2g.com` expects the raw JWT in the `Authorization` header
 * with NO `Bearer ` prefix.
 */
export function normalizeWebJwt(token: string): string {
  return token.trim().replace(/^Bearer\s+/i, "").trim();
}

/**
 * Decode the payload section of a G2G web JWT without verifying its signature.
 * Useful for inspecting expiry (`exp`) and account claims (`user_id` / `sub`).
 */
export function decodeWebJwtClaims(token: string): Record<string, unknown> | null {
  const raw = normalizeWebJwt(token);
  const parts = raw.split(".");
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Return `true` if the decoded JWT `exp` claim is within `skewSeconds` of expiring.
 */
export function isWebJwtExpired(token: string, skewSeconds = 60, nowMs = Date.now()): boolean {
  const claims = decodeWebJwtClaims(token);
  if (!claims || typeof claims.exp !== "number") return false;
  return claims.exp * 1000 <= nowMs + skewSeconds * 1000;
}
