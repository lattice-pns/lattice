import { RedisClient } from "bun";
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

test("POST /push returns 404 without pubkey path param", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/push",
    payload: "Hello",
  });
  expect(res.statusCode).toBe(404);
});

test("POST /push returns 202 when agent not connected", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/push/nonexistent-pubkey",
    payload: "Hello",
  });
  expect(res.statusCode).toBe(202);
  expect(res.json()).toMatchObject({ ok: true, buffered: true });
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
      url: `/push/${pubkey}`,
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

test("POST /push/topics returns 400 with invalid body", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/push/topics",
    headers: { authorization: "Bearer dev-push-secret" },
    payload: { topics: ["news"] }, // missing body
  });
  expect(res.statusCode).toBe(400);
});

test("POST /push/topics returns 200 when agent subscribed to one of the topics", async () => {
  const topic = "test-topic-" + Date.now();
  const pubkey = "test-pubkey-" + Date.now();
  const received: Array<{ id?: string; event?: string; data: unknown }> = [];
  const heartbeatInterval = setInterval(() => {}, 999_999);
  await registry.register({
    pubkey,
    topics: new Set([topic]),
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
    const res = await app.inject({
      method: "POST",
      url: "/push/topics",
      headers: { authorization: "Bearer dev-push-secret" },
      payload: { topics: [topic], body: "Hello" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, recipients: 1 });

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
      body: "Hello",
      topics: [topic],
    });
  } finally {
    clearInterval(heartbeatInterval);
    await registry.deregister(pubkey);
  }
});

test("POST /push/topics deduplicates agents subscribed to multiple topics", async () => {
  const topicA = "test-topic-a-" + Date.now();
  const topicB = "test-topic-b-" + Date.now();
  const pubkey = "test-pubkey-dedup-" + Date.now();
  const received: Array<{ id?: string; event?: string; data: unknown }> = [];
  const heartbeatInterval = setInterval(() => {}, 999_999);
  await registry.register({
    pubkey,
    topics: new Set([topicA, topicB]),
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
    const res = await app.inject({
      method: "POST",
      url: "/push/topics",
      headers: { authorization: "Bearer dev-push-secret" },
      payload: { topics: [topicA, topicB], body: "Dedup test" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, recipients: 1 });

    const maxWait = 500;
    const pollInterval = 10;
    let notifications: typeof received = [];
    for (let waited = 0; waited < maxWait; waited += pollInterval) {
      await new Promise((r) => setTimeout(r, pollInterval));
      notifications = received.filter((r) => r.event === "notification");
      if (notifications.length > 0) break;
    }
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.data).toMatchObject({
      body: "Dedup test",
      topics: [topicA, topicB],
    });
  } finally {
    clearInterval(heartbeatInterval);
    await registry.deregister(pubkey);
  }
});

test("POST /send returns 202 when agent not connected (buffered)", async () => {
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
  expect(res.statusCode).toBe(202);
  expect(res.json()).toMatchObject({ ok: true, buffered: true });
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

test("POST /send returns 400 with invalid pubkey format", async () => {
  const payload = { to: "abc", body: "Hello" };
  const bodyStr = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);

  const res = await app.inject({
    method: "POST",
    url: "/send",
    headers: {
      "X-Agent-Pubkey": "not-64-hex-chars",
      "X-Timestamp": String(timestamp),
      "X-Signature": "0".repeat(128),
      "Content-Type": "application/json",
    },
    payload: bodyStr,
  });
  expect(res.statusCode).toBe(400);
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
  // Timestamp window is no longer enforced; valid sig passes auth → 202 (buffered)
  expect(res.statusCode).toBe(202);
});

// --- SSE Last-Event-ID replay tests ---

test("push buffers event in Redis even when agent is offline", async () => {
  const pubkey = "offline-pubkey-" + Date.now();
  const redis = new RedisClient(
    process.env.REDIS_URL ?? "redis://localhost:6379"
  );

  // No agent registered — push returns 202 and buffers
  const res = await app.inject({
    method: "POST",
    url: `/push/${pubkey}`,
    payload: "buffered-message",
  });
  expect(res.statusCode).toBe(202);

  // Verify event is buffered
  const entries = (await redis.zrangebyscore(
    `events:buffer:${pubkey}`,
    0,
    "+inf"
  )) as string[];
  expect(entries.length).toBe(1);
  const entry = JSON.parse(entries[0]!);
  expect(entry.event).toBe("notification");
  expect(JSON.parse(entry.data).body).toBe("buffered-message");

  await redis.del(`events:buffer:${pubkey}`);
  redis.close();
});

test("getEventsSince returns only events after the given ID", async () => {
  const pubkey = "test-pubkey-since-" + Date.now();
  const redis = new RedisClient(
    process.env.REDIS_URL ?? "redis://localhost:6379"
  );

  // Push two events while offline
  await app.inject({
    method: "POST",
    url: `/push/${pubkey}`,
    payload: "msg-1",
  });
  await app.inject({
    method: "POST",
    url: `/push/${pubkey}`,
    payload: "msg-2",
  });

  const entries = (await redis.zrangebyscore(
    `events:buffer:${pubkey}`,
    0,
    "+inf"
  )) as string[];
  expect(entries.length).toBe(2);
  const firstEventId = JSON.parse(entries[0]!).id as string;

  // getEventsSince(firstEventId) → only msg-2
  const missed = await registry.getEventsSince(pubkey, firstEventId);
  expect(missed.length).toBe(1);
  expect(JSON.parse(missed[0]!.data).body).toBe("msg-2");

  await redis.del(`events:buffer:${pubkey}`);
  redis.close();
});

test("getEventsSince with unknown ID returns all buffered events", async () => {
  const pubkey = "test-pubkey-unknown-" + Date.now();
  const redis = new RedisClient(
    process.env.REDIS_URL ?? "redis://localhost:6379"
  );

  await app.inject({
    method: "POST",
    url: `/push/${pubkey}`,
    payload: "msg-A",
  });
  await app.inject({
    method: "POST",
    url: `/push/${pubkey}`,
    payload: "msg-B",
  });

  // Use a stale/unknown ULID (ts=0) that won't match any buffered event
  const staleId = "00000000000000000000000000";
  const all = await registry.getEventsSince(pubkey, staleId);
  expect(all.length).toBe(2);
  expect(JSON.parse(all[0]!.data).body).toBe("msg-A");
  expect(JSON.parse(all[1]!.data).body).toBe("msg-B");

  await redis.del(`events:buffer:${pubkey}`);
  redis.close();
});

test("getEventsSince with no prior events returns empty array", async () => {
  const pubkey = "test-pubkey-empty-" + Date.now();
  const result = await registry.getEventsSince(
    pubkey,
    "00000000000000000000000000"
  );
  expect(result).toEqual([]);
});
