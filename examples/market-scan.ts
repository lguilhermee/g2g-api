import { G2GClient } from "../src/index.js";

/**
 * Scan live G2G marketplace offers without any authentication.
 * Run: `npx tsx examples/market-scan.ts`
 */
async function main() {
  const seoTerm = process.argv[2] || "wow-gold";
  const query = process.argv[3] || "";

  const summary = await G2GClient.summarizeMarket({
    seoTerm,
    query,
    sort: "lowest_price",
    pageSize: 10,
  });

  console.log(`Market: ${seoTerm} (${summary.total} total offers)`);
  console.log(`Lowest: $${summary.lowestUsd ?? "n/a"} | Median: $${summary.medianUsd ?? "n/a"}\n`);

  for (const offer of summary.offers.slice(0, 5)) {
    console.log(
      `- [${offer.offerId}] $${offer.unitPriceUsd.toFixed(4)} | ${offer.username} (${offer.completedOrders} sales) | ${offer.title}`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
