import { test, expect } from "bun:test";
import { generateKeyPairSync, sign } from "crypto";
import { app } from "./index";
import { registry } from "./src/registry";

function generateEd25519Keys(): { pubkeyHex: string; privateKeyPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const spkiDer = Buffer.from(
    publicKey.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""),
    "base64"
  );
  const pubkeyHex = spkiDer.slice(-32).toString("hex");
  return { pubkeyHex, privateKeyPem: privateKey };
}

function signPayload(
  bodyStr: string,
  timestamp: number,
  privateKeyPem: string
): string {
  const payload = `${bodyStr};${timestamp}`;
  const sig = sign(null, Buffer.from(payload), privateKeyPem);
  return sig.toString("hex");
}

test("GET / returns health status", async () => {
  const res = await app.inject({ method: "GET", url: "/" });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  expect(body).toHaveProperty("status", "ok");
  expect(body).toHaveProperty("connections");
  expect(typeof body.connections).toBe("number");
});

test("POST /push returns 401 without pubkey query param", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/push",
    payload: "Hello",
  });
  expect(res.statusCode).toBe(401);
  expect(res.json()).toMatchObject({ error: "Unauthorized" });
});

test("POST /push returns 404 when agent not connected", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/push?pubkey=nonexistent-pubkey",
    payload: "Hello",
  });
  expect(res.statusCode).toBe(404);
  expect(res.json()).toMatchObject({ error: "Agent not connected" });
});

test("POST /push returns 200 when agent is connected", async () => {
  const pubkey = "test-pubkey-" + Date.now();
  const received: Array<{ event?: string; data: unknown }> = [];
  const heartbeatInterval = setInterval(() => {}, 999_999);
  await registry.register({
    pubkey,
    topics: new Set(),
    write: (event) => {
      received.push({ event: event.event, data: JSON.parse(event.data) });
    },
    disconnect: () => {},
    heartbeatInterval,
  });

  try {
    const res = await app.inject({
      method: "POST",
      url: `/push?pubkey=${pubkey}`,
      payload: JSON.stringify({ foo: "bar" }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });

    const maxWait = 500;
    const pollInterval = 10;
    let notification = received.find((r) => r.event === "notification");
    for (
      let waited = 0;
      !notification && waited < maxWait;
      waited += pollInterval
    ) {
      await new Promise((r) => setTimeout(r, pollInterval));
      notification = received.find((r) => r.event === "notification");
    }
    expect((notification?.data as { body?: string }).body).toBe(
      '{"foo":"bar"}'
    );
  } finally {
    clearInterval(heartbeatInterval);
    await registry.deregister(pubkey);
  }
});

test("POST /push/token returns 400 with invalid body", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/push/token",
    payload: { pubkey: "abc" }, // missing body
  });
  expect(res.statusCode).toBe(400);
});

test("POST /push/token returns 404 when agent not connected", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/push/token",
    payload: { pubkey: "nonexistent-pubkey", body: "Hello" },
  });
  expect(res.statusCode).toBe(404);
  expect(res.json()).toMatchObject({ error: "Agent not connected" });
});

test("POST /push/token returns 200 when agent is connected", async () => {
  const pubkey = "test-pubkey-" + Date.now();
  const heartbeatInterval = setInterval(() => {}, 999_999);
  await registry.register({
    pubkey,
    topics: new Set(),
    write: () => {},
    disconnect: () => {},
    heartbeatInterval,
  });

  try {
    const res = await app.inject({
      method: "POST",
      url: "/push/token",
      payload: { pubkey, body: "Hello" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
  } finally {
    clearInterval(heartbeatInterval);
    await registry.deregister(pubkey);
  }
});

test("POST /push/topic returns 400 with invalid body", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/push/topic",
    headers: { authorization: "Bearer dev-push-secret" },
    payload: { topic: "news" }, // missing body
  });
  expect(res.statusCode).toBe(400);
});

test("POST /push/topic returns 200 when agent subscribed to topic", async () => {
  const topic = "test-topic-" + Date.now();
  const pubkey = "test-pubkey-" + Date.now();
  const heartbeatInterval = setInterval(() => {}, 999_999);
  await registry.register({
    pubkey,
    topics: new Set([topic]),
    write: () => {},
    disconnect: () => {},
    heartbeatInterval,
  });

  try {
    const res = await app.inject({
      method: "POST",
      url: "/push/topic",
      headers: { authorization: "Bearer dev-push-secret" },
      payload: { topic, body: "Hello" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, recipients: 1 });
  } finally {
    clearInterval(heartbeatInterval);
    await registry.deregister(pubkey);
  }
});

test("POST /send returns 404 when agent not connected", async () => {
  const { pubkeyHex, privateKeyPem } = generateEd25519Keys();
  const payload = { to: "nonexistent-pubkey", body: "Hello" };
  const bodyStr = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signPayload(bodyStr, timestamp, privateKeyPem);

  const res = await app.inject({
    method: "POST",
    url: "/send",
    headers: {
      "X-Agent-Pubkey": pubkeyHex,
      "X-Timestamp": String(timestamp),
      "X-Signature": signature,
      "Content-Type": "application/json",
    },
    payload: bodyStr,
  });
  expect(res.statusCode).toBe(404);
  expect(res.json()).toMatchObject({ error: "Agent not connected" });
});

test("POST /send returns 200 and injects from when agent is connected", async () => {
  const recipientPubkey = "test-pubkey-" + Date.now();
  const received: Array<{ id?: string; event?: string; data: unknown }> = [];
  const heartbeatInterval = setInterval(() => {}, 999_999);
  await registry.register({
    pubkey: recipientPubkey,
    topics: new Set(),
    write: (event) => {
      received.push({
        id: event.id,
        event: event.event,
        data: JSON.parse(event.data),
      });
    },
    disconnect: () => {},
    heartbeatInterval,
  });

  try {
    const { pubkeyHex, privateKeyPem } = generateEd25519Keys();
    const payload = { to: recipientPubkey, body: "Hi from sender" };
    const bodyStr = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signPayload(bodyStr, timestamp, privateKeyPem);

    const res = await app.inject({
      method: "POST",
      url: "/send",
      headers: {
        "X-Agent-Pubkey": pubkeyHex,
        "X-Timestamp": String(timestamp),
        "X-Signature": signature,
        "Content-Type": "application/json",
      },
      payload: bodyStr,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });

    // Redis pub/sub is async; poll until notification arrives or timeout
    const maxWait = 500;
    const pollInterval = 10;
    let notification = received.find((r) => r.event === "notification");
    for (
      let waited = 0;
      !notification && waited < maxWait;
      waited += pollInterval
    ) {
      await new Promise((r) => setTimeout(r, pollInterval));
      notification = received.find((r) => r.event === "notification");
    }
    expect(notification?.data).toMatchObject({
      body: "Hi from sender",
      from: pubkeyHex,
    });
  } finally {
    clearInterval(heartbeatInterval);
    await registry.deregister(recipientPubkey);
  }
});

test("POST /send returns 401 without auth", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/send",
    payload: { to: "abc", body: "Hello" },
  });
  expect(res.statusCode).toBe(401);
});

test("POST /send returns 401 with invalid signature", async () => {
  const { pubkeyHex } = generateEd25519Keys();
  const { privateKeyPem: otherKey } = generateEd25519Keys(); // wrong key
  const payload = { to: "abc", body: "Hello" };
  const bodyStr = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signPayload(bodyStr, timestamp, otherKey);

  const res = await app.inject({
    method: "POST",
    url: "/send",
    headers: {
      "X-Agent-Pubkey": pubkeyHex,
      "X-Timestamp": String(timestamp),
      "X-Signature": signature,
      "Content-Type": "application/json",
    },
    payload: bodyStr,
  });
  expect(res.statusCode).toBe(401);
  expect(res.json()).toMatchObject({ error: "Invalid signature" });
});

test("POST /send accepts old timestamp with valid signature", async () => {
  const { pubkeyHex, privateKeyPem } = generateEd25519Keys();
  const payload = { to: "nonexistent-abc", body: "Hello" };
  const bodyStr = JSON.stringify(payload);
  const oldTimestamp = Math.floor(Date.now() / 1000) - 60;
  const signature = signPayload(bodyStr, oldTimestamp, privateKeyPem);

  const res = await app.inject({
    method: "POST",
    url: "/send",
    headers: {
      "X-Agent-Pubkey": pubkeyHex,
      "X-Timestamp": String(oldTimestamp),
      "X-Signature": signature,
      "Content-Type": "application/json",
    },
    payload: bodyStr,
  });
  // Timestamp window is no longer enforced; valid sig passes auth → 404 (agent not connected)
  expect(res.statusCode).toBe(404);
});
