import Fastify, {
  type FastifyRequest,
  type FastifyReply,
  type FastifyError,
} from "fastify";
import { ulid } from "ulid";

import { registry } from "./src/registry";
import { verifyEd25519 } from "./src/auth";
import {
  PushTopicsSchema,
  SendSchema,
  PushParamsSchema,
  Ed25519HeadersSchema,
  type PushParams,
  type PushTopicsBody,
  type SendBody,
} from "./src/schemas";
import { formatSseFrame } from "./src/sse";
import type { SseClient, SseEvent, SubscribeQuery } from "./src/types";

const PUSH_SECRET = process.env.PUSH_SECRET ?? "dev-push-secret";

const app = Fastify({ logger: true });

// Catch-all: unhandled content types (e.g. application/xml, text/html) parsed as raw string
app.addContentTypeParser("*", { parseAs: "string" }, (_req, body, done) => {
  done(null, body);
});

function makeBearer(secret: string) {
  return async function requireBearer(req: FastifyRequest) {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ") || auth.slice(7) !== secret) {
      throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
    }
  };
}

// Format thrown errors consistently as { error: message }
app.setErrorHandler(
  (error: FastifyError, _req: FastifyRequest, reply: FastifyReply) => {
    reply.code(error.statusCode ?? 500).send({ error: error.message });
  }
);

// Health check
app.get("/", async () => {
  return { status: "ok", connections: registry.connectionCount() };
});

// SSE subscribe — agents connect with Ed25519 auth; pubkey is their identity
app.get<{ Querystring: SubscribeQuery; Headers: { "x-agent-pubkey": string } }>(
  "/subscribe",
  {
    preHandler: verifyEd25519,
    schema: { headers: Ed25519HeadersSchema },
  },
  async (req, reply) => {
    const pubkey = req.headers["x-agent-pubkey"]!; // present after verifyEd25519
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
      pubkey,
      topics,
      write,
      disconnect,
      heartbeatInterval,
    };

    await registry.register(client);

    write({
      id: ulid(),
      event: "connected",
      data: JSON.stringify({ pubkey, topics: [...topics] }),
    });

    const lastEventId = req.headers["last-event-id"];
    if (typeof lastEventId === "string") {
      const missed = await registry.getEventsSince(pubkey, lastEventId);
      for (const event of missed) {
        write(event);
      }
    }

    req.raw.on("close", () => {
      clearInterval(heartbeatInterval);
      registry.deregister(pubkey);
      res.end();
    });
  }
);

app.post<{ Params: PushParams }>(
  "/push/:pubkey",
  { schema: { params: PushParamsSchema } },
  async (req, reply) => {
    const { pubkey } = req.params;
    const body =
      typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    const delivered = await registry.pushToToken(pubkey, { body });
    if (!delivered) return reply.code(202).send({ ok: true, buffered: true });
    return { ok: true };
  }
);

// System push to all agents subscribed to any of the given topics (bearer auth, deduplicated)
app.post<{ Body: PushTopicsBody }>(
  "/push/topics",
  {
    preHandler: makeBearer(PUSH_SECRET),
    schema: { body: PushTopicsSchema },
  },
  async (req) => {
    const { topics, body } = req.body;
    const recipients = await registry.pushToTopics(topics, { body, topics });
    return { ok: true, recipients };
  }
);

// Agent-to-agent send — Ed25519 auth; `from` injected from verified pubkey
app.post<{ Body: SendBody; Headers: { "x-agent-pubkey": string } }>(
  "/send",
  {
    preHandler: verifyEd25519,
    schema: { body: SendSchema, headers: Ed25519HeadersSchema },
  },
  async (req, reply) => {
    const { to, body } = req.body;
    const from = req.headers["x-agent-pubkey"]!; // present after verifyEd25519
    const delivered = await registry.pushToToken(to, { from, body });
    if (!delivered) return reply.code(202).send({ ok: true, buffered: true });
    return { ok: true };
  }
);

export { app };

const start = async () => {
  try {
    await app.listen({ port: 3000, host: "0.0.0.0" });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

if (import.meta.main) {
  start();
}
