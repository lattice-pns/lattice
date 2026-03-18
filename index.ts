import Fastify, { type FastifyRequest, type FastifyReply } from "fastify";
import { randomUUID } from "crypto";

import { registry } from "./src/registry";
import { verifyEd25519 } from "./src/auth";
import type {
  SseClient,
  SseEvent,
  SubscribeQuery,
  PushTokenBody,
  PushTopicBody,
} from "./src/types";

const PUSH_SECRET = process.env.PUSH_SECRET ?? "dev-push-secret";

const app = Fastify({ logger: true });

function makeBearer(secret: string) {
  return async function requireBearer(
    req: FastifyRequest,
    reply: FastifyReply
  ) {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ") || auth.slice(7) !== secret) {
      reply.code(401).send({ error: "Unauthorized" });
    }
  };
}

function formatSseFrame(event: SseEvent): string {
  let frame = "";
  if (event.id) frame += `id: ${event.id}\n`;
  if (event.event) frame += `event: ${event.event}\n`;
  frame += `data: ${event.data}\n\n`;
  return frame;
}

// Health check
app.get("/", async () => {
  return { status: "ok", connections: registry.connectionCount() };
});

// SSE subscribe
app.get<{ Querystring: SubscribeQuery }>(
  "/subscribe",
  { preHandler: verifyEd25519 },
  async (req, reply) => {
    // The public key hex is the device token, already verified by verifyEd25519
    const deviceToken = req.headers["x-agent-pubkey"] as string;
    const { topics: topicsStr } = req.query;

    const topics = topicsStr
      ? new Set(
          topicsStr
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        )
      : new Set<string>();

    reply.hijack();

    const res = reply.raw;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const write = (event: SseEvent) => {
      if (!res.writableEnded) {
        res.write(formatSseFrame(event));
      }
    };

    const disconnect = () => {
      if (!res.writableEnded) {
        res.end();
      }
    };

    const heartbeatInterval = setInterval(() => {
      if (!res.writableEnded) {
        res.write(": ping\n\n");
      }
    }, 25_000);

    const client: SseClient = {
      deviceToken,
      topics,
      write,
      disconnect,
      heartbeatInterval,
    };

    write({
      id: randomUUID(),
      event: "connected",
      data: JSON.stringify({ deviceToken, topics: [...topics] }),
    });

    await registry.register(client);

    req.raw.on("close", () => {
      clearInterval(heartbeatInterval);
      registry.deregister(deviceToken);
      res.end();
    });
  }
);

// Push to device token
app.post<{ Body: PushTokenBody }>(
  "/push/token",
  {
    preHandler: makeBearer(PUSH_SECRET),
    schema: {
      body: {
        type: "object",
        required: ["deviceToken", "notification"],
        properties: {
          deviceToken: { type: "string" },
          notification: {
            type: "object",
            required: ["title", "body"],
            properties: {
              title: { type: "string" },
              body: { type: "string" },
              data: { type: "object" },
            },
          },
        },
      },
    },
  },
  async (req, reply) => {
    const { deviceToken, notification } = req.body;
    const delivered = await registry.pushToToken(deviceToken, notification);
    if (!delivered) {
      return reply.code(404).send({ error: "Device not connected" });
    }
    return { ok: true };
  }
);

// Push to topic
app.post<{ Body: PushTopicBody }>(
  "/push/topic",
  {
    preHandler: makeBearer(PUSH_SECRET),
    schema: {
      body: {
        type: "object",
        required: ["topic", "notification"],
        properties: {
          topic: { type: "string" },
          notification: {
            type: "object",
            required: ["title", "body"],
            properties: {
              title: { type: "string" },
              body: { type: "string" },
              data: { type: "object" },
            },
          },
        },
      },
    },
  },
  async (req, reply) => {
    const { topic, notification } = req.body;
    const recipients = await registry.pushToTopic(topic, notification);
    return { ok: true, recipients };
  }
);

const start = async () => {
  try {
    await app.listen({ port: 3000, host: "0.0.0.0" });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
