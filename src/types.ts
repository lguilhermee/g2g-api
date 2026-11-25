export interface G2GOpenApiCredentials {
  /** Seller OpenAPI key (`g2g-api-key` header) from the G2G Seller OpenAPI portal. */
  apiKey: string;
  /** Seller OpenAPI secret used as the HMAC-SHA256 signing key. */
  apiSecret: string;
  /** Numeric G2G account user ID (`g2g-userid` header). */
  userId: string;
  /** Optional base URL override (defaults to `https://open-api.g2g.com`). */
  baseUrl?: string;
}

export interface G2GRefreshedTokens {
  accessToken: string;
  refreshToken?: string;
  longLivedToken?: string;
  activeDeviceToken?: string;
}

export interface G2GWebCredentials {
  /** Raw G2G web access JWT (sent in `Authorization` without a `Bearer ` prefix). */
  webToken: string;
  /** Numeric G2G seller ID (same as your G2G user ID). */
  sellerId: string;
  /** Optional refresh token from G2G web session for automatic renewal on 401. */
  refreshToken?: string;
  /** Optional long-lived session token from G2G web session. */
  longLivedToken?: string;
  /** Optional active device token paired with the web session. */
  activeDeviceToken?: string;
  /** Invoked whenever `refreshWebSession()` rotates your session tokens so you can persist them. */
  onTokensRefreshed?: (tokens: G2GRefreshedTokens) => Promise<void> | void;
}

export interface G2GClientOptions {
  openApi?: G2GOpenApiCredentials;
  web?: G2GWebCredentials;
  /** Optional timeout in milliseconds for HTTP calls (default `20000`). */
  timeoutMs?: number;
  /** Optional SendBird App ID override (defaults to G2G's production SendBird App ID). */
  sendBirdAppId?: string;
}

export interface G2GOpenApiResponse<T = Record<string, unknown>> {
  request_id?: string;
  code?: string | number;
  message?: string;
  warning?: string;
  payload?: T;
}

export interface G2GMarketSearchParams {
  /** G2G catalog slug, e.g. `once-human-items`, `wow-gold`, `valorant-accounts`. */
  seoTerm: string;
  /** Optional free-text search query. */
  query?: string;
  /** Optional G2G `filter_attr` string (e.g. `collection_id:dataset_id`). */
  filterAttr?: string;
  /** Set `0` to ungroup stacked offers, `1` to group. */
  group?: 0 | 1;
  /** Results per page (1..48, default `24`). */
  pageSize?: number;
  /** 1-based page number (default `1`). */
  page?: number;
  /** Sort order (default `lowest_price`). */
  sort?: "recommended_v2" | "lowest_price" | "highest_price";
  /** Display currency code (default `USD`). */
  currency?: string;
  /** Country code (default `US`). */
  country?: string;
}

export interface G2GMarketOffer {
  offerId: string;
  title: string;
  description: string;
  sellerId: string;
  username: string;
  unitPriceUsd: number;
  unitPriceUsdCents: number;
  minQty: number;
  availableQty: number;
  completedOrders: number;
  isOnline: boolean;
  verifiedSeller: boolean;
  serviceId: string;
  brandId: string;
  regionId: string;
  productId: string;
  deliveryMethodIds: string[];
  offerAttributes: unknown[];
}

export interface G2GMarketSummary {
  offers: G2GMarketOffer[];
  total: number;
  lowestUsd: number | null;
  medianUsd: number | null;
}

export interface G2GChatChannel {
  channelUrl: string;
  name: string;
  isDm: boolean;
  buyerId: string;
  buyerName: string;
  buyerAvatar: string;
  buyerOnline: boolean;
  unreadCount: number;
  lastMessage: string;
  lastMessageAt: number;
  lastSenderId: string;
  memberCount: number;
}

export interface G2GChatMessage {
  messageId: string;
  channelUrl: string;
  senderId: string;
  senderName: string;
  senderAvatar: string;
  isMe: boolean;
  body: string;
  createdAt: number;
  messageType: string;
}

export interface G2GWebhookVerifyParams {
  /** Exact callback URL registered in the G2G Seller OpenAPI dashboard. */
  webhookUrl: string;
  /** Your numeric G2G user ID. */
  userId: string;
  /** Value of the `g2g-timestamp` header (13-digit Unix epoch in ms). */
  timestamp: string;
  /** Value of the `g2g-signature` header (64 hex chars). */
  signatureHeader: string;
  /** Webhook secret configured in G2G Seller OpenAPI dashboard. */
  webhookSecret: string;
  /** Maximum allowed clock drift / replay window in ms (default 5 minutes). */
  maxAgeMs?: number;
}

export type G2GNormalizedOrderState =
  | "paid"
  | "preparing"
  | "to_deliver"
  | "start_deliver"
  | "new_order"
  | "processing"
  | "delivering"
  | "delivering_in_progress"
  | "delivered"
  | "cancelled"
  | "unverified";
