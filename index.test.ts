import { test, expect } from "bun:test";
import { app } from "./index";

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
