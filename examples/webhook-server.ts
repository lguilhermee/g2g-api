import "dotenv/config";
import { createG2GServer, G2G_API_VERSION } from "../src/index.js";

/**
 * Run the standalone G2G API v0.1 REST server + HMAC-verified webhook endpoint.
 * Run: `npx tsx examples/webhook-server.ts`
 */
const port = Number(process.env.PORT || 4080);

const app = createG2GServer({
  onWebhookEvent: async ({ eventType, normalizedState, payload }) => {
    console.log(`[webhook] event=${eventType} state=${normalizedState}`, payload);
  },
});

app.listen(port, () => {
  console.log(`G2G API v${G2G_API_VERSION} running on http://localhost:${port}/api/v${G2G_API_VERSION}`);
});
