import { RedisClient } from "bun";
import { randomUUID } from "crypto";

import type { SseClient, Notification } from "./types";

const INSTANCE_ID = randomUUID();
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

// Two separate connections: one for commands, one for pub/sub
const redis = new RedisClient(REDIS_URL);
const subscriber = await redis.duplicate();

class Registry {
  private clientsByPubkey = new Map<string, SseClient>();

  async init() {
    await subscriber.subscribe(
      `push:instance:${INSTANCE_ID}`,
      (message: string) => {
        const { pubkey, notification } = JSON.parse(message) as {
          pubkey: string;
          notification: Notification;
        };
        this.deliverLocal(pubkey, notification);
      }
    );
  }

  async register(client: SseClient) {
    const existing = this.clientsByPubkey.get(client.pubkey);
    if (existing) {
      existing.disconnect();
    }
    this.clientsByPubkey.set(client.pubkey, client);

    const ops: Promise<unknown>[] = [
      redis.set(`pubkey:${client.pubkey}:instance`, INSTANCE_ID),
    ];
    for (const topic of client.topics) {
      ops.push(redis.sadd(`topic:${topic}`, client.pubkey));
    }
    await Promise.all(ops);
  }

  async deregister(pubkey: string) {
    const client = this.clientsByPubkey.get(pubkey);
    this.clientsByPubkey.delete(pubkey);

    const ops: Promise<unknown>[] = [redis.del(`pubkey:${pubkey}:instance`)];
    if (client) {
      for (const topic of client.topics) {
        ops.push(redis.srem(`topic:${topic}`, pubkey));
      }
    }
    await Promise.all(ops);
  }

  private deliverLocal(pubkey: string, notification: Notification): boolean {
    const client = this.clientsByPubkey.get(pubkey);
    if (!client) return false;

    client.write({
      id: randomUUID(),
      event: "notification",
      data: JSON.stringify(notification),
    });
    return true;
  }

  async pushToToken(
    pubkey: string,
    notification: Notification
  ): Promise<boolean> {
    const instanceId = await redis.get(`pubkey:${pubkey}:instance`);
    if (!instanceId) return false;

    const receivers = await redis.publish(
      `push:instance:${instanceId}`,
      JSON.stringify({ pubkey, notification })
    );
    return receivers > 0;
  }

  async pushToTopic(
    topic: string,
    notification: Notification
  ): Promise<number> {
    const pubkeys = await redis.smembers(`topic:${topic}`);
    if (pubkeys.length === 0) return 0;

    const results = await Promise.all(
      pubkeys.map((pubkey) => this.pushToToken(pubkey, notification))
    );
    return results.filter(Boolean).length;
  }

  connectionCount(): number {
    return this.clientsByPubkey.size;
  }
}

export const registry = new Registry();
await registry.init();
