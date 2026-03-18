import { test, expect } from "bun:test";
import { formatSseFrame } from "./sse";

test("formatSseFrame includes data", () => {
  const frame = formatSseFrame({ data: "hello" });
  expect(frame).toBe("data: hello\n\n");
});

test("formatSseFrame includes id when present", () => {
  const frame = formatSseFrame({ id: "abc-123", data: "{}" });
  expect(frame).toContain("id: abc-123\n");
  expect(frame).toContain("data: {}\n\n");
});

test("formatSseFrame includes event when present", () => {
  const frame = formatSseFrame({ event: "notification", data: "{}" });
  expect(frame).toContain("event: notification\n");
  expect(frame).toContain("data: {}\n\n");
});

test("formatSseFrame emits full SSE format", () => {
  const frame = formatSseFrame({
    id: "x",
    event: "connected",
    data: JSON.stringify({ ok: true }),
  });
  expect(frame).toBe('id: x\nevent: connected\ndata: {"ok":true}\n\n');
});
