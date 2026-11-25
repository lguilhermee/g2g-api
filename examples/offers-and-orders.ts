import "dotenv/config";
import { G2GClient, allowsG2GDelivery, classifyG2GOrderState } from "../src/index.js";

/**
 * Inspect your G2G seller profile, live offers, and recent orders.
 * Configure `.env` first (see `docs/CREDENTIALS.md`).
 * Run: `npx tsx examples/offers-and-orders.ts`
 */
async function main() {
  const client = G2GClient.fromEnv();

  // 1. Official Seller OpenAPI v2 (requires G2G_API_KEY, G2G_API_SECRET, G2G_USER_ID)
  if (process.env.G2G_API_KEY) {
    const store = await client.getStore();
    console.log("OpenAPI v2 Store:", store.payload);
  }

  // 2. Web Seller Session API (requires G2G_WEB_TOKEN, G2G_SELLER_ID)
  if (process.env.G2G_WEB_TOKEN) {
    const profile = await client.getWebUserInfo();
    console.log("Web Profile:", (profile as { payload?: unknown }).payload);

    const offers = (await client.listMyWebOffers(1, 20)) as {
      payload?: { results?: Array<Record<string, unknown>> };
    };
    console.log(`Live Web Offers: ${(offers.payload?.results || []).length}`);

    const orders = (await client.listMyWebOrders({ page: 1, pageSize: 10 })) as {
      payload?: { results?: Array<Record<string, unknown>> };
    };
    for (const order of orders.payload?.results || []) {
      console.log(
        `Order #${order.order_id} | state=${classifyG2GOrderState(order)} | deliverable=${allowsG2GDelivery(order)}`
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
