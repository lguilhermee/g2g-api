import "dotenv/config";
import { G2GClient } from "../src/index.js";

/**
 * List recent G2G buyer DM conversations and read messages via the SendBird bridge.
 * Requires `G2G_WEB_TOKEN` and `G2G_SELLER_ID` in `.env`.
 * Run: `npx tsx examples/live-chat.ts`
 */
async function main() {
  const client = G2GClient.fromEnv();
  const channels = await client.listChatChannels({ limit: 15, onlyDms: true });

  console.log(`Found ${channels.length} G2G DM channel(s):\n`);
  for (const ch of channels) {
    console.log(
      `- ${ch.buyerName} (#${ch.buyerId}) | unread=${ch.unreadCount} | online=${ch.buyerOnline} | "${ch.lastMessage.slice(0, 60)}"`
    );
  }

  if (channels[0]) {
    console.log(`\nLatest messages in ${channels[0].channelUrl}:`);
    const messages = await client.getChatMessages(channels[0].channelUrl, 5);
    for (const msg of messages) {
      console.log(`  [${msg.isMe ? "YOU" : msg.senderName}] ${msg.body}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
