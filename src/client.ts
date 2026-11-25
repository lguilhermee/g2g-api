import { normalizeWebJwt, signG2GOpenApiRequest } from "./auth.js";
import type {
  G2GChatChannel,
  G2GChatMessage,
  G2GClientOptions,
  G2GMarketOffer,
  G2GMarketSearchParams,
  G2GMarketSummary,
  G2GOpenApiCredentials,
  G2GOpenApiResponse,
  G2GWebCredentials,
} from "./types.js";

export const G2G_API_VERSION = "0.1";
export const G2G_DEFAULT_OPEN_API_BASE = "https://open-api.g2g.com";
export const G2G_SLS_BASE = "https://sls.g2g.com";
export const G2G_SENDBIRD_APP_ID = "34201740-152E-401E-AD8F-5C72EEABA386";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

interface CachedSendBirdSession {
  sessionKey: string;
  expiresAt: number;
}

/**
 * Unified G2G.com API client (API v0.1) supporting all four G2G interfaces:
 *
 * 1. **Official Seller OpenAPI v2** (`open-api.g2g.com`) — HMAC-SHA256 signed
 * 2. **Public Market Scanner** (`sls.g2g.com/offer/search`) — unauthenticated
 * 3. **Web Seller Session API** (`sls.g2g.com`) — raw JWT + automatic 401 token refresh
 * 4. **Live Buyer Chat API** (`sls.g2g.com/chat` + SendBird v3 WS/REST bridge)
 */
export class G2GClient {
  private openApi?: G2GOpenApiCredentials;
  private web?: G2GWebCredentials;
  private readonly timeoutMs: number;
  private readonly sendBirdAppId: string;
  private readonly sendBirdSessionCache = new Map<string, CachedSendBirdSession>();

  constructor(options?: G2GClientOptions) {
    this.openApi = options?.openApi ? { ...options.openApi } : undefined;
    this.web = options?.web ? { ...options.web } : undefined;
    this.timeoutMs = options?.timeoutMs ?? 20_000;
    this.sendBirdAppId = options?.sendBirdAppId || G2G_SENDBIRD_APP_ID;
  }

  /**
   * Construct a `G2GClient` from standard `G2G_*` environment variables.
   */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): G2GClient {
    const apiKey = env.G2G_API_KEY?.trim() || "";
    const apiSecret = env.G2G_API_SECRET?.trim() || "";
    const userId = env.G2G_USER_ID?.trim() || "";
    const baseUrl = env.G2G_OPEN_API_BASE_URL?.trim() || undefined;

    const webToken = env.G2G_WEB_TOKEN?.trim() || "";
    const sellerId = env.G2G_SELLER_ID?.trim() || userId;
    const refreshToken = env.G2G_REFRESH_TOKEN?.trim() || undefined;
    const longLivedToken = env.G2G_LONG_LIVED_TOKEN?.trim() || undefined;
    const activeDeviceToken = env.G2G_ACTIVE_DEVICE_TOKEN?.trim() || undefined;

    return new G2GClient({
      openApi: apiKey && apiSecret && userId ? { apiKey, apiSecret, userId, baseUrl } : undefined,
      web: webToken && sellerId
        ? { webToken, sellerId, refreshToken, longLivedToken, activeDeviceToken }
        : undefined,
    });
  }

  private get sellerId(): string {
    return this.web?.sellerId || this.openApi?.userId || "";
  }

  private get sendBirdRestBase(): string {
    return `https://api-${this.sendBirdAppId}.sendbird.com/v3`;
  }

  // ==================== 1. OFFICIAL SELLER OPENAPI V2 ====================

  async openApiRequest<T = Record<string, unknown>>(
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
    pathWithQuery: string,
    body?: unknown
  ): Promise<G2GOpenApiResponse<T>> {
    if (!this.openApi?.apiKey || !this.openApi?.apiSecret || !this.openApi?.userId) {
      throw new Error("G2G OpenAPI credentials (apiKey, apiSecret, userId) are not configured");
    }
    const base = (this.openApi.baseUrl || G2G_DEFAULT_OPEN_API_BASE).replace(/\/$/, "");
    const urlPath = pathWithQuery.startsWith("/") ? pathWithQuery : `/${pathWithQuery}`;
    const headers = signG2GOpenApiRequest({
      urlPath,
      apiKey: this.openApi.apiKey,
      apiSecret: this.openApi.apiSecret,
      userId: this.openApi.userId,
    });

    const resp = await fetch(`${base}${urlPath}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    const text = await resp.text();
    let json: G2GOpenApiResponse<T> = {};
    try {
      json = text ? (JSON.parse(text) as G2GOpenApiResponse<T>) : {};
    } catch {
      json = { message: text || `HTTP ${resp.status}` };
    }

    if (
      !resp.ok ||
      (json.code && String(json.code) !== "20000001" && !String(json.code).startsWith("200"))
    ) {
      throw new Error(
        `G2G OpenAPI ${method} ${urlPath} failed (${resp.status}): ${json.message || text.slice(0, 200)}`
      );
    }
    return json;
  }

  getStore() {
    return this.openApiRequest("GET", "/v2/store");
  }

  getServices(language = "en") {
    return this.openApiRequest("GET", `/v2/services?language=${encodeURIComponent(language)}`);
  }

  getBrands(serviceId: string, query = "", language = "en") {
    const qs = new URLSearchParams({ language, ...(query ? { q: query } : {}) });
    return this.openApiRequest("GET", `/v2/services/${encodeURIComponent(serviceId)}/brands?${qs}`);
  }

  getProducts(params: { serviceId: string; brandId: string; categoryId?: string }) {
    const qs = new URLSearchParams({
      service_id: params.serviceId,
      brand_id: params.brandId,
      ...(params.categoryId ? { category_id: params.categoryId } : {}),
    });
    return this.openApiRequest("GET", `/v2/products?${qs}`);
  }

  getProductAttributes(productId: string) {
    return this.openApiRequest("GET", `/v2/products/${encodeURIComponent(productId)}/attributes`);
  }

  getProductPricing(productId: string, payload: Record<string, unknown> = {}) {
    return this.openApiRequest("POST", `/v2/products/${encodeURIComponent(productId)}/pricing`, payload);
  }

  createOffer(offerPayload: Record<string, unknown>) {
    return this.openApiRequest<{ offer_id: string }>("POST", "/v2/offers", offerPayload);
  }

  searchOffers(payload: Record<string, unknown>) {
    return this.openApiRequest("POST", "/v2/offers/search", payload);
  }

  getOffer(offerId: string) {
    return this.openApiRequest("GET", `/v2/offers/${encodeURIComponent(offerId)}`);
  }

  updateOffer(offerId: string, patch: Record<string, unknown>) {
    return this.openApiRequest("PATCH", `/v2/offers/${encodeURIComponent(offerId)}`, patch);
  }

  deleteOffer(offerId: string) {
    return this.openApiRequest("DELETE", `/v2/offers/${encodeURIComponent(offerId)}`);
  }

  getOrder(orderId: string) {
    return this.openApiRequest("GET", `/v2/orders/${encodeURIComponent(orderId)}`);
  }

  getDeliveries(orderId: string, after?: string) {
    const qs = after ? `?after=${encodeURIComponent(after)}` : "";
    return this.openApiRequest("GET", `/v2/orders/${encodeURIComponent(orderId)}/delivery${qs}`);
  }

  getDeliveryDetail(orderId: string, deliveryId: string) {
    return this.openApiRequest(
      "GET",
      `/v2/orders/${encodeURIComponent(orderId)}/delivery/${encodeURIComponent(deliveryId)}`
    );
  }

  deliverOrder(orderId: string, payload: Record<string, unknown>) {
    return this.openApiRequest("POST", `/v2/orders/${encodeURIComponent(orderId)}/delivery`, payload);
  }

  listInventoryCodes(offerId: string) {
    return this.openApiRequest("GET", `/v2/offers/${encodeURIComponent(offerId)}/inventory_items`);
  }

  uploadInventoryCode(offerId: string, payload: Record<string, unknown>) {
    return this.openApiRequest(
      "POST",
      `/v2/offers/${encodeURIComponent(offerId)}/inventory_items`,
      payload
    );
  }

  deleteInventoryCode(offerId: string, itemId: string) {
    return this.openApiRequest(
      "DELETE",
      `/v2/offers/${encodeURIComponent(offerId)}/inventory_items/${encodeURIComponent(itemId)}`
    );
  }

  searchWebhookLogs(payload: Record<string, unknown>) {
    return this.openApiRequest("POST", "/v2/logs/webhooks/search", payload);
  }

  // ==================== 2. PUBLIC MARKET SCANNER (sls.g2g.com) ====================

  static async searchMarket(
    params: G2GMarketSearchParams
  ): Promise<{ offers: G2GMarketOffer[]; total: number }> {
    const qs = new URLSearchParams({
      seo_term: params.seoTerm,
      page_size: String(Math.min(48, Math.max(1, params.pageSize || 24))),
      page: String(Math.max(1, params.page || 1)),
      sort: params.sort || "lowest_price",
      currency: params.currency || "USD",
      country: params.country || "US",
      include_localization: "0",
      v: "v2",
      ...(params.query?.trim() ? { q: params.query.trim() } : {}),
      ...(params.filterAttr?.trim() ? { filter_attr: params.filterAttr.trim() } : {}),
      ...(params.group !== undefined ? { group: String(params.group) } : {}),
    });

    const resp = await fetch(`${G2G_SLS_BASE}/offer/search?${qs.toString()}`, {
      headers: {
        "User-Agent": DEFAULT_USER_AGENT,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!resp.ok) {
      throw new Error(`G2G market search failed (${resp.status})`);
    }

    const json = (await resp.json()) as {
      payload?: { results?: Array<Record<string, unknown>>; total_result?: number };
    };
    const rows = json.payload?.results || [];

    const offers: G2GMarketOffer[] = rows.map((r) => {
      const unitUsd = Number(r.unit_price_in_usd ?? r.converted_unit_price ?? r.unit_price ?? 0);
      return {
        offerId: String(r.offer_id || ""),
        title: String(r.title || ""),
        description: String(r.description || ""),
        sellerId: String(r.seller_id || ""),
        username: String(r.username || ""),
        unitPriceUsd: unitUsd,
        unitPriceUsdCents: Math.max(1, Math.round(unitUsd * 100)),
        minQty: Math.max(1, Number(r.min_qty || 1)),
        availableQty: Math.max(0, Number(r.available_qty || 0)),
        completedOrders: Math.max(0, Number(r.total_completed_orders || r.total_success_order || 0)),
        isOnline: Boolean(r.is_online),
        verifiedSeller: Boolean(r.verified_seller),
        serviceId: String(r.service_id || ""),
        brandId: String(r.brand_id || ""),
        regionId: String(r.region_id || ""),
        productId: String(r.lgc_products_id || r.relation_id || ""),
        deliveryMethodIds: Array.isArray(r.delivery_method_ids)
          ? (r.delivery_method_ids as string[])
          : [],
        offerAttributes: Array.isArray(r.offer_attributes) ? r.offer_attributes : [],
      };
    });

    return {
      offers,
      total: Number(json.payload?.total_result || offers.length),
    };
  }

  static async summarizeMarket(params: G2GMarketSearchParams): Promise<G2GMarketSummary> {
    const { offers, total } = await G2GClient.searchMarket(params);
    const prices = offers
      .map((o) => o.unitPriceUsd)
      .filter((p) => Number.isFinite(p) && p > 0)
      .sort((a, b) => a - b);

    return {
      offers,
      total,
      lowestUsd: prices[0] ?? null,
      medianUsd: prices.length ? prices[Math.floor(prices.length / 2)] : null,
    };
  }

  // ==================== 3. WEB SELLER SESSION API (sls.g2g.com) ====================

  /**
   * Rotate an expired web access JWT using `POST /user/refresh_access`.
   * Automatically invoked on HTTP 401 when refresh tokens are configured.
   */
  async refreshWebSession(): Promise<string> {
    if (!this.web?.sellerId || (!this.web.refreshToken && !this.web.longLivedToken)) {
      throw new Error("G2G refresh tokens (refreshToken / longLivedToken) are not configured");
    }

    const resp = await fetch(`${G2G_SLS_BASE}/user/refresh_access`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Origin: "https://www.g2g.com",
        Referer: "https://www.g2g.com/",
      },
      body: JSON.stringify({
        user_id: this.web.sellerId,
        refresh_token: this.web.refreshToken || "",
        active_device_token: this.web.activeDeviceToken || "",
        long_lived_token: this.web.longLivedToken || "",
      }),
      signal: AbortSignal.timeout(15_000),
    });

    const json = (await resp.json().catch(() => ({}))) as {
      payload?: {
        access_token?: string;
        refresh_token?: string;
        long_lived_token?: string;
        active_device_token?: string;
      };
      messages?: Array<{ text?: string }>;
    };

    const newAccess = json.payload?.access_token;
    if (!resp.ok || !newAccess) {
      throw new Error(
        `G2G session refresh failed (${resp.status}): ${json.messages?.[0]?.text || "invalid refresh token"}`
      );
    }

    this.web.webToken = newAccess;
    if (json.payload?.refresh_token) this.web.refreshToken = json.payload.refresh_token;
    if (json.payload?.long_lived_token) this.web.longLivedToken = json.payload.long_lived_token;
    if (json.payload?.active_device_token) {
      this.web.activeDeviceToken = json.payload.active_device_token;
    }

    if (this.web.onTokensRefreshed) {
      await this.web.onTokensRefreshed({
        accessToken: newAccess,
        refreshToken: this.web.refreshToken,
        longLivedToken: this.web.longLivedToken,
        activeDeviceToken: this.web.activeDeviceToken,
      });
    }

    return newAccess;
  }

  async webRequest<T = Record<string, unknown>>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    urlPath: string,
    body?: unknown,
    allowRefresh = true
  ): Promise<T> {
    if (!this.web?.webToken) {
      throw new Error("G2G Web Seller JWT token is not configured");
    }

    const rawToken = normalizeWebJwt(this.web.webToken);
    const resp = await fetch(`${G2G_SLS_BASE}${urlPath}`, {
      method,
      headers: {
        Authorization: rawToken,
        "Content-Type": "application/json",
        Accept: "application/json",
        Origin: "https://www.g2g.com",
        Referer: "https://www.g2g.com/",
        "User-Agent": DEFAULT_USER_AGENT,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (resp.status === 401 && allowRefresh && (this.web.refreshToken || this.web.longLivedToken)) {
      await this.refreshWebSession();
      return this.webRequest<T>(method, urlPath, body, false);
    }

    const text = await resp.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      json = { message: text };
    }

    if (!resp.ok) {
      const msgs = Array.isArray(json.messages)
        ? (json.messages as Array<{ text?: string }>)
            .map((m) => m.text)
            .filter(Boolean)
            .join("; ")
        : "";
      throw new Error(
        `G2G Web API ${method} ${urlPath} failed (${resp.status}): ${msgs || String(json.message || text.slice(0, 220))}`
      );
    }

    return json as T;
  }

  getWebUserInfo() {
    const sid = this.sellerId;
    if (!sid) throw new Error("G2G sellerId is required");
    return this.webRequest("GET", `/user/${encodeURIComponent(sid)}/info`);
  }

  createWebOffer(payload: Record<string, unknown>) {
    const sid = this.sellerId;
    return this.webRequest<{ payload?: { offer_id?: string } }>("POST", "/offer?v=v2", {
      seller_id: sid,
      ...payload,
    });
  }

  updateWebOffer(offerId: string, payload: Record<string, unknown>) {
    const sid = this.sellerId;
    return this.webRequest<{ payload?: { offer_id?: string } }>(
      "PUT",
      `/offer/${encodeURIComponent(offerId)}?v=v2`,
      { seller_id: sid, ...payload }
    );
  }

  getWebOffer(offerId: string) {
    const sid = this.sellerId;
    return this.webRequest<{ payload?: Record<string, unknown> }>(
      "GET",
      `/offer/${encodeURIComponent(offerId)}?v=v2&seller_id=${encodeURIComponent(sid)}`
    );
  }

  listMyWebOffers(page = 1, pageSize = 50) {
    const sid = this.sellerId;
    if (!sid) throw new Error("G2G sellerId is required");
    return this.webRequest(
      "GET",
      `/v3/offer/seller/${encodeURIComponent(sid)}/my_offers?page=${page}&page_size=${pageSize}&tree_version=v2`
    );
  }

  bulkUpdateWebOfferStatus(offerIds: string[], status: "live" | "delisted" | "remove") {
    const sid = this.sellerId;
    if (!sid) throw new Error("G2G sellerId is required");
    return this.webRequest("PUT", `/offer/seller/${encodeURIComponent(sid)}/bulk_update?v=v2`, {
      offer_ids: offerIds,
      status,
    });
  }

  removeWebOffer(offerId: string) {
    return this.bulkUpdateWebOfferStatus([offerId], "remove");
  }

  listMyWebOrders(params?: { status?: string; page?: number; pageSize?: number }) {
    const sid = this.sellerId;
    const qs = new URLSearchParams({
      seller_id: sid,
      page: String(params?.page || 1),
      page_size: String(params?.pageSize || 30),
      ...(params?.status ? { status: params.status } : {}),
    });
    return this.webRequest("GET", `/order/list_my_order?${qs.toString()}`);
  }

  getWebOrderItem(itemId: string) {
    const sid = this.sellerId;
    return this.webRequest<{ payload?: Record<string, unknown> }>(
      "GET",
      `/order/item/${encodeURIComponent(itemId)}?seller_id=${encodeURIComponent(sid)}`
    );
  }

  /**
   * Step 1 of G2G's 3-step seller delivery flow ("View Delivery Details"):
   * transitions `seller_sub_status` from `to_deliver` -> `start_deliver`.
   */
  startWebDelivery(itemId: string) {
    const sid = this.sellerId;
    const qs = sid ? `?seller_id=${encodeURIComponent(sid)}` : "";
    return this.webRequest<{ payload?: Record<string, unknown> }>(
      "PUT",
      `/order/item/${encodeURIComponent(itemId)}/start_deliver${qs}`
    );
  }

  /**
   * Step 2 of G2G's 3-step seller delivery flow ("Start Delivery"):
   * transitions `start_deliver` -> `delivering`, notifies the buyer, and extends
   * the cancellation timer by +30 minutes.
   */
  markWebOrderDelivering(itemId: string) {
    const sid = this.sellerId;
    const qs = sid ? `?seller_id=${encodeURIComponent(sid)}` : "";
    return this.webRequest<{ payload?: Record<string, unknown> }>(
      "PUT",
      `/order/item/${encodeURIComponent(itemId)}/mark_as_delivering${qs}`
    );
  }

  /**
   * Step 3 of G2G's 3-step seller delivery flow ("Confirm Delivered"):
   * submits delivered quantity via `PUT /order/item/:itemId/delivered_qty`.
   */
  updateWebDeliveredQty(itemId: string, qty: number) {
    const sid = this.sellerId;
    const qs = sid ? `?seller_id=${encodeURIComponent(sid)}` : "";
    return this.webRequest<{ payload?: Record<string, unknown> }>(
      "PUT",
      `/order/item/${encodeURIComponent(itemId)}/delivered_qty${qs}`,
      { qty: Math.max(1, Math.round(qty)) }
    );
  }

  completeWebDelivery(itemId: string, payload: Record<string, unknown> = {}) {
    const qty = Number(payload.qty ?? payload.delivery_qty ?? 1);
    return this.updateWebDeliveredQty(itemId, Number.isFinite(qty) && qty > 0 ? qty : 1);
  }

  /**
   * Idempotently advance an order item through Steps 1 & 2 (`to_deliver` -> `start_deliver` -> `delivering`).
   */
  async advanceWebDeliveryToDelivering(itemId: string): Promise<{
    alreadyDelivering: boolean;
    alreadyDelivered: boolean;
    initialSubStatus: string;
  }> {
    const itemResp = await this.getWebOrderItem(itemId).catch(() => null);
    const p = (itemResp?.payload || {}) as Record<string, unknown>;
    const initialSubStatus = String(p.seller_sub_status || p.order_item_status || "")
      .trim()
      .toLowerCase();

    if (
      ["delivered", "completed", "awaiting_buyer_confirmation", "received"].includes(
        initialSubStatus
      )
    ) {
      return { alreadyDelivering: false, alreadyDelivered: true, initialSubStatus };
    }
    if (["delivering", "delivering_in_progress"].includes(initialSubStatus)) {
      return { alreadyDelivering: true, alreadyDelivered: false, initialSubStatus };
    }

    if (!initialSubStatus || initialSubStatus === "to_deliver" || initialSubStatus === "preparing") {
      try {
        await this.startWebDelivery(itemId);
      } catch (err) {
        const msg = (err as Error).message || "";
        if (!/already|start_deliver|delivering|in.?progress|31042/i.test(msg)) {
          throw err;
        }
      }
    }

    await this.markWebOrderDelivering(itemId);
    return { alreadyDelivering: false, alreadyDelivered: false, initialSubStatus };
  }

  getUnreadChatCount() {
    const sid = this.sellerId;
    if (!sid) throw new Error("G2G sellerId is required");
    return this.webRequest<{ payload?: { unread_count?: number } }>(
      "GET",
      `/chat/user/${encodeURIComponent(sid)}/unread_message_count`
    );
  }

  getWebNotifications() {
    const sid = this.sellerId;
    if (!sid) throw new Error("G2G sellerId is required");
    return this.webRequest("GET", `/user/${encodeURIComponent(sid)}/notification`);
  }

  // ==================== 4. LIVE BUYER CHAT (SENDBIRD + SLS/CHAT) ====================

  private async getChatSessionProfile(): Promise<{ accessToken: string; userId: string }> {
    const sid = this.sellerId;
    if (!sid) throw new Error("G2G sellerId is required for live chat");
    const prof = await this.webRequest<{
      payload?: { session_tokens?: Array<{ session_token?: string }>; user_id?: string };
    }>("POST", "/chat/user", { user_id: sid });

    const accessToken = prof.payload?.session_tokens?.[0]?.session_token || "";
    if (!accessToken) {
      throw new Error("Could not acquire G2G SendBird access token from /chat/user");
    }
    return { accessToken, userId: sid };
  }

  /**
   * Exchange a G2G web session for a SendBird `Session-Key` via the 2-step bridge:
   *   1. `POST https://sls.g2g.com/chat/user` -> SendBird `access_token`
   *   2. Connect to SendBird WebSocket -> read `LOGI{ "key": "..." }` frame
   *
   * Cached in memory for 25 minutes per seller ID.
   */
  async getSendBirdSessionKey(forceRefresh = false): Promise<{ sessionKey: string; userId: string }> {
    const sid = this.sellerId;
    if (!sid) throw new Error("G2G sellerId is required for live chat");

    const cached = this.sendBirdSessionCache.get(sid);
    if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
      return { sessionKey: cached.sessionKey, userId: sid };
    }

    const { accessToken } = await this.getChatSessionProfile();
    const wsUrl =
      `wss://ws-${this.sendBirdAppId}.sendbird.com/?p=JS&pv=Chrome&sv=4.14.0` +
      `&ai=${this.sendBirdAppId}&user_id=${encodeURIComponent(sid)}` +
      `&access_token=${encodeURIComponent(accessToken)}&Request-Sent-Timestamp=${Date.now()}`;

    const sessionKey = await new Promise<string>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const timer = setTimeout(() => {
        try {
          ws.close();
        } catch {
          // ignore
        }
        reject(new Error("G2G SendBird WebSocket login timed out"));
      }, 12_000);

      ws.onmessage = (ev) => {
        const raw = String(ev.data || "");
        if (raw.startsWith("LOGI")) {
          clearTimeout(timer);
          try {
            const parsed = JSON.parse(raw.slice(4)) as { key?: string; message?: string };
            ws.close();
            if (parsed.key) resolve(parsed.key);
            else reject(new Error(`SendBird LOGI rejected: ${parsed.message || raw.slice(0, 160)}`));
          } catch (err) {
            ws.close();
            reject(err);
          }
        }
      };

      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error("G2G SendBird WebSocket connection error"));
      };
    });

    this.sendBirdSessionCache.set(sid, {
      sessionKey,
      expiresAt: Date.now() + 25 * 60 * 1000,
    });
    return { sessionKey, userId: sid };
  }

  private async sendBirdRequest<T = Record<string, unknown>>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    pathWithQuery: string,
    body?: unknown,
    allowRetry = true
  ): Promise<T> {
    const { sessionKey } = await this.getSendBirdSessionKey(false);
    const resp = await fetch(`${this.sendBirdRestBase}${pathWithQuery}`, {
      method,
      headers: {
        "Session-Key": sessionKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });

    const text = await resp.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      json = { message: text };
    }

    if (
      !resp.ok &&
      allowRetry &&
      (resp.status === 401 || json.code === 400303 || json.code === 400302)
    ) {
      await this.getSendBirdSessionKey(true);
      return this.sendBirdRequest<T>(method, pathWithQuery, body, false);
    }

    if (!resp.ok) {
      throw new Error(
        `G2G Chat API ${method} ${pathWithQuery} failed (${resp.status}): ${String(json.message || text.slice(0, 200))}`
      );
    }

    return json as T;
  }

  async listChatChannels(opts?: { limit?: number; onlyDms?: boolean }): Promise<G2GChatChannel[]> {
    const sid = this.sellerId;
    const limit = Math.min(50, Math.max(1, opts?.limit ?? 30));
    const res = await this.sendBirdRequest<{ channels?: Array<Record<string, unknown>> }>(
      "GET",
      `/users/${encodeURIComponent(sid)}/my_group_channels?limit=${limit}&order=latest_last_message&show_member=true&show_read_receipt=true&show_empty=false`
    );

    const channels: G2GChatChannel[] = (res.channels || []).map((ch) => {
      const channelUrl = String(ch.channel_url || "");
      const members = Array.isArray(ch.members)
        ? (ch.members as Array<Record<string, unknown>>)
        : [];
      const peer = members.find((m) => String(m.user_id) !== String(sid));
      const lastMsg = (ch.last_message || {}) as Record<string, unknown>;
      const lastUser = (lastMsg.user || {}) as Record<string, unknown>;
      const isDm = channelUrl.startsWith("g2g_dm_") || members.length <= 2;

      const rawAvatar = String(peer?.profile_url || "").trim();
      const buyerAvatar = /^https?:\/\//i.test(rawAvatar) ? rawAvatar : "";

      return {
        channelUrl,
        name: String(ch.name || peer?.nickname || channelUrl),
        isDm,
        buyerId: String(peer?.user_id || ""),
        buyerName: String(peer?.nickname || peer?.user_id || ch.name || "Buyer"),
        buyerAvatar,
        buyerOnline: Boolean(peer?.is_online),
        unreadCount: Number(ch.unread_message_count || 0),
        lastMessage: String(lastMsg.message || ""),
        lastMessageAt: Number(lastMsg.created_at || ch.created_at || 0),
        lastSenderId: String(lastUser.user_id || ""),
        memberCount: Number(ch.member_count || members.length),
      };
    });

    return opts?.onlyDms ? channels.filter((c) => c.isDm) : channels;
  }

  async getChatMessages(channelUrl: string, limit = 40): Promise<G2GChatMessage[]> {
    const sid = this.sellerId;
    const res = await this.sendBirdRequest<{ messages?: Array<Record<string, unknown>> }>(
      "GET",
      `/group_channels/${encodeURIComponent(channelUrl)}/messages?message_ts=${Date.now()}&prev_limit=${Math.min(100, Math.max(1, limit))}&next_limit=0&include=true&reverse=false`
    );

    return (res.messages || []).map((m) => {
      const u = (m.user || {}) as Record<string, unknown>;
      const senderId = String(u.user_id || "");
      const rawAv = String(u.profile_url || "").trim();
      return {
        messageId: String(m.message_id || ""),
        channelUrl,
        senderId,
        senderName: String(u.nickname || senderId || "System"),
        senderAvatar: /^https?:\/\//i.test(rawAv) ? rawAv : "",
        isMe: senderId === String(sid),
        body: String(m.message || ""),
        createdAt: Number(m.created_at || 0),
        messageType: String(m.type || "MESG"),
      };
    });
  }

  async createOrGetDmChannel(buyerId: string): Promise<string> {
    const sid = this.sellerId;
    if (!sid || !buyerId) {
      throw new Error("Both sellerId and buyerId are required to open a G2G DM");
    }
    const res = await this.webRequest<{
      payload?: { channel_details?: { channel_url?: string } };
    }>("POST", "/chat/channel", {
      channel_id: `${sid}_${buyerId}`,
      channel_name: `Direct Message Channel Between ${sid} and ${buyerId}`,
      inviter_id: sid,
      user_ids: [sid, String(buyerId)],
      channel_type: "dm",
    });
    const url = res.payload?.channel_details?.channel_url || "";
    if (!url) throw new Error("G2G /chat/channel did not return a channel_url");
    return url;
  }

  async sendChatMessage(
    channelUrl: string,
    message: string
  ): Promise<{ messageId: string; channelUrl: string; body: string }> {
    const sid = this.sellerId;
    const trimmed = message.trim();
    if (!trimmed) throw new Error("Cannot send an empty G2G chat message");

    try {
      const resp = await this.sendBirdRequest<{ message_id?: string | number }>(
        "POST",
        `/group_channels/${encodeURIComponent(channelUrl)}/messages`,
        {
          message_type: "MESG",
          user_id: sid,
          message: trimmed,
        }
      );
      return { messageId: String(resp.message_id || Date.now()), channelUrl, body: trimmed };
    } catch {
      const { accessToken } = await this.getChatSessionProfile();
      const wsUrl =
        `wss://ws-${this.sendBirdAppId}.sendbird.com/?p=JS&pv=Chrome&sv=4.14.0` +
        `&ai=${this.sendBirdAppId}&user_id=${encodeURIComponent(sid)}` +
        `&access_token=${encodeURIComponent(accessToken)}&Request-Sent-Timestamp=${Date.now()}`;
      const reqId = String(Date.now());

      const msgId = await new Promise<string>((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        const timer = setTimeout(() => {
          try {
            ws.close();
          } catch {
            // ignore
          }
          reject(new Error("G2G SendBird WS send timed out"));
        }, 12_000);

        ws.onmessage = (ev) => {
          const raw = String(ev.data || "");
          if (raw.startsWith("LOGI")) {
            const payload = JSON.stringify({
              channel_url: channelUrl,
              message: trimmed,
              req_id: reqId,
              custom_type: "",
              data: "",
            });
            ws.send(`MESG${payload}\n`);
          } else if (raw.startsWith("MESG")) {
            try {
              const parsed = JSON.parse(raw.slice(4)) as {
                req_id?: string;
                msg_id?: string | number;
              };
              if (String(parsed.req_id) === reqId) {
                clearTimeout(timer);
                ws.close();
                resolve(String(parsed.msg_id || reqId));
              }
            } catch {
              // ignore non-matching frame
            }
          } else if (raw.startsWith("EROR")) {
            clearTimeout(timer);
            ws.close();
            reject(new Error(`G2G Chat WS error: ${raw.slice(4, 240)}`));
          }
        };

        ws.onerror = () => {
          clearTimeout(timer);
          reject(new Error("G2G Chat WS send failed"));
        };
      });

      return { messageId: msgId, channelUrl, body: trimmed };
    }
  }

  async markChatChannelRead(channelUrl: string): Promise<void> {
    const sid = this.sellerId;
    try {
      await this.sendBirdRequest(
        "PUT",
        `/group_channels/${encodeURIComponent(channelUrl)}/messages/mark_as_read`,
        { user_id: sid }
      );
    } catch {
      // Non-fatal
    }
  }
}
