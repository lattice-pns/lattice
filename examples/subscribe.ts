/**
 * Example SSE subscriber client.
 *
 * Usage:
 *   bun run examples/subscribe.ts [deviceToken] [topics]
 *
 * Examples:
 *   bun run examples/subscribe.ts
 *   bun run examples/subscribe.ts my-device sports,news
 */

const SUBSCRIBE_SECRET = process.env.SUBSCRIBE_SECRET ?? "dev-subscribe-secret";
const SERVER_URL = process.env.SERVER_URL ?? "http://localhost:3000";

const deviceToken = process.argv[2] ?? `device-${Math.random().toString(36).slice(2, 8)}`;
const topics = process.argv[3] ?? "general";

const url = `${SERVER_URL}/subscribe?deviceToken=${encodeURIComponent(deviceToken)}&topics=${encodeURIComponent(topics)}`;

console.log(`Connecting as deviceToken=${deviceToken}, topics=${topics}`);

const res = await fetch(url, {
  headers: { Authorization: `Bearer ${SUBSCRIBE_SECRET}` },
});

if (!res.ok || !res.body) {
  console.error(`Failed to connect: ${res.status} ${res.statusText}`);
  process.exit(1);
}

const decoder = new TextDecoder();
let buffer = "";

for await (const chunk of res.body) {
  buffer += decoder.decode(chunk, { stream: true });

  // SSE frames are separated by double newlines
  const frames = buffer.split("\n\n");
  buffer = frames.pop() ?? "";

  for (const frame of frames) {
    if (!frame.trim() || frame.startsWith(": ping")) continue;

    const lines = frame.split("\n");
    const parsed: Record<string, string> = {};
    for (const line of lines) {
      const colon = line.indexOf(":");
      if (colon === -1) continue;
      const key = line.slice(0, colon).trim();
      const value = line.slice(colon + 1).trim();
      parsed[key] = value;
    }

    const timestamp = new Date().toISOString();
    if (parsed.event === "connected") {
      console.log(`[${timestamp}] connected`, JSON.parse(parsed.data ?? "{}"));
    } else if (parsed.event === "notification") {
      console.log(`[${timestamp}] notification`, JSON.parse(parsed.data ?? "{}"));
    } else {
      console.log(`[${timestamp}] event=${parsed.event ?? "(none)"}`, parsed.data);
    }
  }
}
