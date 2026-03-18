import { RedisClient } from "bun";
import { randomUUID } from "crypto";

import type { SseClient, NotificationPayload } from "./types";

const INSTANCE_ID = randomUUID();
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

// Two separate connections: one for commands, one for pub/sub
const redis = new RedisClient(REDIS_URL);
const subscriber = await redis.duplicate();

class Registry {
  private clientsByToken = new Map<string, SseClient>();

  async init() {
    await subscriber.subscribe(
      `push:instance:${INSTANCE_ID}`,
      (message: string) => {
        const { deviceToken, payload } = JSON.parse(message) as {
          deviceToken: string;
          payload: NotificationPayload;
        };
        this.deliverLocal(deviceToken, payload);
      }
    );
  }

  async register(client: SseClient) {
    const existing = this.clientsByToken.get(client.deviceToken);
    if (existing) {
      existing.disconnect();
    }
    this.clientsByToken.set(client.deviceToken, client);

    const ops: Promise<unknown>[] = [
      redis.set(`token:${client.deviceToken}:instance`, INSTANCE_ID),
    ];
    for (const topic of client.topics) {
      ops.push(redis.sadd(`topic:${topic}`, client.deviceToken));
    }
    await Promise.all(ops);
  }

  async deregister(deviceToken: string) {
    const client = this.clientsByToken.get(deviceToken);
    this.clientsByToken.delete(deviceToken);

    const ops: Promise<unknown>[] = [
      redis.del(`token:${deviceToken}:instance`),
    ];
    if (client) {
      for (const topic of client.topics) {
        ops.push(redis.srem(`topic:${topic}`, deviceToken));
      }
    }
    await Promise.all(ops);
  }

  private deliverLocal(
    deviceToken: string,
    payload: NotificationPayload
  ): boolean {
    const client = this.clientsByToken.get(deviceToken);
    if (!client) return false;

    client.write({
      id: randomUUID(),
      event: "notification",
      data: JSON.stringify(payload),
    });
    return true;
  }

  async pushToToken(
    deviceToken: string,
    payload: NotificationPayload
  ): Promise<boolean> {
    const instanceId = await redis.get(`token:${deviceToken}:instance`);
    if (!instanceId) return false;

    await redis.publish(
      `push:instance:${instanceId}`,
      JSON.stringify({ deviceToken, payload })
    );
    return true;
  }

  async pushToTopic(
    topic: string,
    payload: NotificationPayload
  ): Promise<number> {
    const tokens = await redis.smembers(`topic:${topic}`);
    if (tokens.length === 0) return 0;

    const results = await Promise.all(
      tokens.map((token) => this.pushToToken(token, payload))
    );
    return results.filter(Boolean).length;
  }

  connectionCount(): number {
    return this.clientsByToken.size;
  }
}

export const registry = new Registry();
await registry.init();
