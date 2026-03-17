import { randomUUID } from "crypto";

import type { SseClient, NotificationPayload, SseEvent } from "./types";

class Registry {
  private clientsByToken = new Map<string, SseClient>();
  private clientsByTopic = new Map<string, Set<string>>();

  register(client: SseClient): void {
    const existing = this.clientsByToken.get(client.deviceToken);
    if (existing) {
      existing.disconnect();
    }

    this.clientsByToken.set(client.deviceToken, client);

    for (const topic of client.topics) {
      if (!this.clientsByTopic.has(topic)) {
        this.clientsByTopic.set(topic, new Set());
      }
      this.clientsByTopic.get(topic)!.add(client.deviceToken);
    }
  }

  deregister(deviceToken: string): void {
    const client = this.clientsByToken.get(deviceToken);
    if (!client) return;

    this.clientsByToken.delete(deviceToken);

    for (const topic of client.topics) {
      const subscribers = this.clientsByTopic.get(topic);
      if (subscribers) {
        subscribers.delete(deviceToken);
        if (subscribers.size === 0) {
          this.clientsByTopic.delete(topic);
        }
      }
    }
  }

  pushToToken(deviceToken: string, payload: NotificationPayload): boolean {
    const client = this.clientsByToken.get(deviceToken);
    if (!client) return false;

    client.write({
      id: randomUUID(),
      event: "notification",
      data: JSON.stringify(payload),
    });
    return true;
  }

  pushToTopic(topic: string, payload: NotificationPayload): number {
    const subscribers = this.clientsByTopic.get(topic);
    if (!subscribers || subscribers.size === 0) return 0;

    const event: SseEvent = {
      id: randomUUID(),
      event: "notification",
      data: JSON.stringify(payload),
    };

    let count = 0;
    for (const deviceToken of subscribers) {
      const client = this.clientsByToken.get(deviceToken);
      if (client) {
        client.write(event);
        count++;
      }
    }
    return count;
  }

  connectionCount(): number {
    return this.clientsByToken.size;
  }
}

export const registry = new Registry();
