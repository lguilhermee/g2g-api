import "dotenv/config";
import express, { type Express, type RequestHandler } from "express";
import { G2G_API_VERSION, G2GClient } from "./client.js";
import { classifyG2GOrderState } from "./order-status.js";
import { createG2GWebhookMiddleware } from "./webhook.js";

export interface G2GServerOptions {
  client?: G2GClient;
  /** Optional bearer token protecting non-webhook API routes. */
  serverApiToken?: string;
  /** Webhook verification settings (optional; if omitted, webhook route responds 503). */
  webhook?: {
    webhookUrl: string;
    userId: string;
    webhookSecret: string;
  };
  /** Custom callback invoked whenever a verified G2G webhook arrives. */
  onWebhookEvent?: (event: {
    eventType: string;
    normalizedState: string;
    payload: Record<string, unknown>;
  }) => Promise<void> | void;
}

/**
 * Create a standalone Express REST API server exposing G2G API v0.1 under `/api/v0.1`.
 */
export function createG2GServer(options: G2GServerOptions = {}): Express {
  const app = express();
  app.use(express.json({ limit: "2mb" }));

  const client = options.client ?? G2GClient.fromEnv(process.env);
  const apiToken = options.serverApiToken ?? process.env.SERVER_API_TOKEN?.trim() ?? "";

  const requireApiToken: RequestHandler = (req, res, next) => {
    if (!apiToken) {
      next();
      return;
    }
    const auth = req.header("authorization") || "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (token !== apiToken) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  };

  const api = express.Router();

  api.get("/health", (_req, res) => {
    res.json({ ok: true, apiVersion: G2G_API_VERSION });
  });

  // 1. Public market scanner
  api.get("/market/search", requireApiToken, async (req, res) => {
    try {
      const seoTerm = String(req.query.seoTerm || "").trim();
      if (!seoTerm) {
        res.status(400).json({ error: "Query parameter `seoTerm` is required" });
        return;
      }
      const summary = await G2GClient.summarizeMarket({
        seoTerm,
        query: req.query.q ? String(req.query.q) : undefined,
        filterAttr: req.query.filterAttr ? String(req.query.filterAttr) : undefined,
        pageSize: req.query.pageSize ? Number(req.query.pageSize) : 24,
        page: req.query.page ? Number(req.query.page) : 1,
        sort: (req.query.sort as "lowest_price" | "highest_price" | "recommended_v2") || "lowest_price",
        currency: req.query.currency ? String(req.query.currency) : "USD",
      });
      res.json({ apiVersion: G2G_API_VERSION, ...summary });
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  // 2. Connection & credential diagnostics
  api.post("/diagnostics", requireApiToken, async (_req, res) => {
    const report: Record<string, unknown> = { apiVersion: G2G_API_VERSION };
    try {
      const store = await client.getStore();
      report.openApi = { ok: true, store: store.payload || store };
    } catch (err) {
      report.openApi = { ok: false, error: (err as Error).message };
    }
    try {
      const info = (await client.getWebUserInfo()) as { payload?: Record<string, unknown> };
      report.webApi = { ok: true, user: info.payload || info };
    } catch (err) {
      report.webApi = { ok: false, error: (err as Error).message };
    }
    res.json(report);
  });

  // 3. Official OpenAPI v2 routes
  api.get("/store", requireApiToken, async (_req, res) => {
    try {
      res.json(await client.getStore());
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  api.get("/services", requireApiToken, async (req, res) => {
    try {
      const language = req.query.language ? String(req.query.language) : "en";
      res.json(await client.getServices(language));
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  api.get("/services/:serviceId/brands", requireApiToken, async (req, res) => {
    try {
      const q = req.query.q ? String(req.query.q) : "";
      const language = req.query.language ? String(req.query.language) : "en";
      res.json(await client.getBrands(String(req.params.serviceId), q, language));
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  api.get("/products", requireApiToken, async (req, res) => {
    try {
      const serviceId = String(req.query.serviceId || "").trim();
      const brandId = String(req.query.brandId || "").trim();
      if (!serviceId || !brandId) {
        res.status(400).json({ error: "Query parameters `serviceId` and `brandId` are required" });
        return;
      }
      res.json(
        await client.getProducts({
          serviceId,
          brandId,
          categoryId: req.query.categoryId ? String(req.query.categoryId) : undefined,
        })
      );
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  api.get("/offers/:offerId", requireApiToken, async (req, res) => {
    try {
      res.json(await client.getOffer(String(req.params.offerId)));
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // 4. Web Seller routes
  api.get("/web/offers", requireApiToken, async (req, res) => {
    try {
      const page = Number(req.query.page || 1);
      const pageSize = Number(req.query.pageSize || 50);
      res.json(await client.listMyWebOffers(page, pageSize));
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  api.get("/web/orders", requireApiToken, async (req, res) => {
    try {
      res.json(
        await client.listMyWebOrders({
          status: req.query.status ? String(req.query.status) : undefined,
          page: Number(req.query.page || 1),
          pageSize: Number(req.query.pageSize || 30),
        })
      );
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  api.post("/web/orders/:itemId/start-deliver", requireApiToken, async (req, res) => {
    try {
      res.json(await client.advanceWebDeliveryToDelivering(String(req.params.itemId)));
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  api.post("/web/orders/:itemId/deliver", requireApiToken, async (req, res) => {
    try {
      const qty = Math.max(1, Number(req.body?.qty || 1));
      res.json(await client.updateWebDeliveredQty(String(req.params.itemId), qty));
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // 5. Live SendBird Buyer Chat routes
  api.get("/chat/channels", requireApiToken, async (req, res) => {
    try {
      const limit = Number(req.query.limit || 30);
      const onlyDms = String(req.query.onlyDms ?? "true") !== "false";
      const channels = await client.listChatChannels({ limit, onlyDms });
      res.json({ channels, count: channels.length });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  api.get("/chat/channels/:channelUrl/messages", requireApiToken, async (req, res) => {
    try {
      const limit = Number(req.query.limit || 40);
      const messages = await client.getChatMessages(String(req.params.channelUrl), limit);
      res.json({ messages });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  api.post("/chat/channels/:channelUrl/messages", requireApiToken, async (req, res) => {
    try {
      const message = String(req.body?.message || "").trim();
      if (!message) {
        res.status(400).json({ error: "`message` is required" });
        return;
      }
      const sent = await client.sendChatMessage(String(req.params.channelUrl), message);
      res.status(201).json(sent);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // 6. Verified Inbound G2G Webhook receiver
  const webhookMiddleware = createG2GWebhookMiddleware(async () => {
    if (options.webhook) return options.webhook;
    const webhookSecret = process.env.G2G_WEBHOOK_SECRET?.trim() || "";
    const userId = process.env.G2G_USER_ID?.trim() || process.env.G2G_SELLER_ID?.trim() || "";
    const webhookUrl = process.env.G2G_WEBHOOK_URL?.trim() || "";
    if (!webhookSecret || !userId || !webhookUrl) return null;
    return { webhookSecret, userId, webhookUrl };
  });

  api.post("/webhook", webhookMiddleware, async (req, res) => {
    const payload = (req.body || {}) as Record<string, unknown>;
    const eventType = String(payload.event || payload.event_type || payload.type || "order.webhook");
    const normalizedState = classifyG2GOrderState(payload, eventType);

    if (options.onWebhookEvent) {
      await options.onWebhookEvent({ eventType, normalizedState, payload });
    }
    res.status(200).json({ ok: true, eventType, normalizedState });
  });

  app.use(`/api/v${G2G_API_VERSION}`, api);
  return app;
}

// Start standalone HTTP server when executed directly
const isDirectRun =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("server.ts") || process.argv[1].endsWith("server.js"));

if (isDirectRun) {
  const port = Number(process.env.PORT || 4080);
  const app = createG2GServer();
  app.listen(port, () => {
    console.log(`[g2g-api v${G2G_API_VERSION}] REST server listening on http://localhost:${port}/api/v${G2G_API_VERSION}`);
  });
}
