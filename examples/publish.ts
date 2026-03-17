/**
 * Example publisher script.
 *
 * Usage:
 *   bun run examples/publish.ts token  <deviceToken> <title> [body]
 *   bun run examples/publish.ts topic  <topic>       <title> [body]
 *
 * Examples:
 *   bun run examples/publish.ts token my-device "Hello" "World"
 *   bun run examples/publish.ts topic sports "Goal!" "2-1"
 */

const PUSH_SECRET = process.env.PUSH_SECRET ?? "dev-push-secret";
const SERVER_URL = process.env.SERVER_URL ?? "http://localhost:3000";

const [mode, target, title, body = ""] = process.argv.slice(2);

if (!mode || !target || !title) {
  console.error("Usage: publish.ts <token|topic> <deviceToken|topic> <title> [body]");
  process.exit(1);
}

if (mode !== "token" && mode !== "topic") {
  console.error(`Unknown mode "${mode}". Use "token" or "topic".`);
  process.exit(1);
}

const endpoint = mode === "token" ? "/push/token" : "/push/topic";
const bodyKey = mode === "token" ? "deviceToken" : "topic";

const payload = {
  [bodyKey]: target,
  notification: { title, body },
};

const res = await fetch(`${SERVER_URL}${endpoint}`, {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${PUSH_SECRET}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(payload),
});

const json = await res.json();

if (!res.ok) {
  console.error(`Error ${res.status}:`, json);
  process.exit(1);
}

console.log(`Sent to ${mode} "${target}":`, json);
