import { test, expect } from "bun:test";
import { app } from "./index";
import { registry } from "./src/registry";

test("smoke", () => {
  expect(1).toBe(1);
});

test("GET / returns health status", async () => {
  const res = await app.inject({ method: "GET", url: "/" });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  expect(body).toHaveProperty("status", "ok");
  expect(body).toHaveProperty("connections");
  expect(typeof body.connections).toBe("number");
});

test("POST /push/token returns 401 without auth", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/push/token",
    payload: {
      deviceToken: "abc",
      notification: { title: "Hi", body: "Hello" },
    },
  });
  expect(res.statusCode).toBe(401);
});

test("POST /push/token returns 401 with wrong Bearer", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/push/token",
    headers: { authorization: "Bearer wrong-secret" },
    payload: {
      deviceToken: "abc",
      notification: { title: "Hi", body: "Hello" },
    },
  });
  expect(res.statusCode).toBe(401);
});

test("POST /push/token returns 400 with invalid body", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/push/token",
    headers: { authorization: "Bearer dev-push-secret" },
    payload: { deviceToken: "abc" }, // missing notification
  });
  expect(res.statusCode).toBe(400);
});

test("POST /push/token returns 404 when device not connected", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/push/token",
    headers: { authorization: "Bearer dev-push-secret" },
    payload: {
      deviceToken: "nonexistent-device",
      notification: { title: "Hi", body: "Hello" },
    },
  });
  expect(res.statusCode).toBe(404);
  expect(res.json()).toMatchObject({ error: "Device not connected" });
});

test("POST /push/token returns 200 when device is connected", async () => {
  const deviceToken = "test-device-" + Date.now();
  const heartbeatInterval = setInterval(() => {}, 999_999);
  await registry.register({
    deviceToken,
    topics: new Set(),
    write: () => {},
    disconnect: () => {},
    heartbeatInterval,
  });

  try {
    const res = await app.inject({
      method: "POST",
      url: "/push/token",
      headers: { authorization: "Bearer dev-push-secret" },
      payload: {
        deviceToken,
        notification: { title: "Hi", body: "Hello" },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
  } finally {
    clearInterval(heartbeatInterval);
    await registry.deregister(deviceToken);
  }
});

test("POST /push/topic returns 401 without auth", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/push/topic",
    payload: {
      topic: "news",
      notification: { title: "Hi", body: "Hello" },
    },
  });
  expect(res.statusCode).toBe(401);
});

test("POST /push/topic returns 400 with invalid body", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/push/topic",
    headers: { authorization: "Bearer dev-push-secret" },
    payload: { topic: "news" }, // missing notification
  });
  expect(res.statusCode).toBe(400);
});
