import { RedisClient } from "bun";
import { randomUUID } from "crypto";
import { monotonicFactory, decodeTime } from "ulid";

import type { SseClient, SseEvent, Notification } from "./types";

const ulid = monotonicFactory();

const INSTANCE_ID = randomUUID();
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const MAX_BUFFER_EVENTS = 100;
const BUFFER_TTL_SECS = parseInt(
  process.env.LATTICE_EVENT_BUFFER_TTL_SECS ?? "300",
  10
);

// Two separate connections: one for commands, one for pub/sub
const redis = new RedisClient(REDIS_URL);
const subscriber = await redis.duplicate();

class Registry {
  private clientsByPubkey = new Map<string, SseClient>();

  async init() {
    await subscriber.subscribe(
      `push:instance:${INSTANCE_ID}`,
      (message: string) => {
        const { pubkey, notification, eventId } = JSON.parse(message) as {
          pubkey: string;
          notification: Notification;
          eventId?: string;
        };
        this.deliverLocal(pubkey, notification, eventId);
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

  private async bufferEvent(pubkey: string, event: SseEvent): Promise<void> {
    const key = `events:buffer:${pubkey}`;
    const score = decodeTime(event.id!);
    const member = JSON.stringify({
      id: event.id,
      event: event.event,
      data: event.data,
    });
    await redis.zadd(key, score, member);
    await redis.zremrangebyrank(key, 0, -(MAX_BUFFER_EVENTS + 1));
    await redis.expire(key, BUFFER_TTL_SECS);
  }

  async getEventsSince(
    pubkey: string,
    lastEventId: string
  ): Promise<SseEvent[]> {
    let tsX: number;
    try {
      tsX = decodeTime(lastEventId);
    } catch {
      // Not a valid ULID; return all buffered events
      tsX = 0;
    }

    const key = `events:buffer:${pubkey}`;
    const entries = (await redis.zrangebyscore(key, tsX, "+inf")) as string[];
    if (!entries || entries.length === 0) return [];

    const parsed: SseEvent[] = entries.map((e) => JSON.parse(e) as SseEvent);

    const idx = parsed.findIndex((e) => e.id === lastEventId);
    if (idx >= 0) {
      return parsed.slice(idx + 1);
    }
    // lastEventId not found (expired/too old) → replay all fetched entries
    return parsed;
  }

  private deliverLocal(
    pubkey: string,
    notification: Notification,
    eventId?: string
  ): boolean {
    const client = this.clientsByPubkey.get(pubkey);
    if (!client) return false;

    client.write({
      id: eventId,
      event: "notification",
      data: JSON.stringify(notification),
    });
    return true;
  }

  async pushToToken(
    pubkey: string,
    notification: Notification
  ): Promise<boolean> {
    const eventId = ulid();
    const event: SseEvent = {
      id: eventId,
      event: "notification",
      data: JSON.stringify(notification),
    };
    await this.bufferEvent(pubkey, event);

    const instanceId = await redis.get(`pubkey:${pubkey}:instance`);
    if (!instanceId) return false;

    const receivers = await redis.publish(
      `push:instance:${instanceId}`,
      JSON.stringify({ pubkey, notification, eventId })
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
