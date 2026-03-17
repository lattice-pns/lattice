# lattice

An APNs-inspired push notification server using Server-Sent Events (SSE). Clients hold open SSE connections identified by their Ed25519 public key; a backend can push notifications to specific clients or broadcast to a topic.

## Setup

```bash
bun install
cp .env.example .env
```

## Development

```bash
bun run dev
```

## Environment Variables

| Variable      | Default           | Description                     |
| ------------- | ----------------- | ------------------------------- |
| `PUSH_SECRET` | `dev-push-secret` | Bearer token for push endpoints |

## Authentication

Subscribers authenticate using **Ed25519 keypairs**. On each connection the client:

1. Generates an Ed25519 keypair (ephemeral by default)
2. Signs the request payload as `";{unix_timestamp}"` with its private key
3. Sends three headers with every request:

| Header           | Description                               |
| ---------------- | ----------------------------------------- |
| `X-Agent-Pubkey` | 64-char hex Ed25519 public key (32 bytes) |
| `X-Timestamp`    | Unix timestamp in seconds                 |
| `X-Signature`    | 128-char hex Ed25519 signature (64 bytes) |

The **public key is the device token**. Timestamps must be within ±30 seconds of the server clock (replay protection).

## API

### `GET /`

Health check. Returns the number of active connections.

```json
{ "status": "ok", "connections": 3 }
```

### `GET /subscribe?topics=`

Opens an SSE connection. Requires Ed25519 auth headers (see above).

| Query param | Required | Description                            |
| ----------- | -------- | -------------------------------------- |
| `topics`    | No       | Comma-separated list of topics to join |

The device token is derived from `X-Agent-Pubkey`. If a client reconnects with the same public key, the previous connection is evicted. A `: ping` comment frame is sent every 25 seconds to keep the connection alive through proxies.

### `POST /push/token`

Push a notification to a specific device. Requires `Authorization: Bearer <PUSH_SECRET>`.

```json
{
  "deviceToken": "<64-char-hex-pubkey>",
  "notification": { "title": "Hello", "body": "World" }
}
```

Returns `404` if the device is not connected.

### `POST /push/topic`

Broadcast a notification to all subscribers of a topic. Requires `Authorization: Bearer <PUSH_SECRET>`.

```json
{
  "topic": "sports",
  "notification": { "title": "Goal!", "body": "2-1" }
}
```

Returns `{ "ok": true, "recipients": N }`.

## SSE Event Format

```
id: <uuid>
event: notification
data: {"title":"...","body":"...","data":{...}}

```

On connect, an initial `event: connected` frame is sent with the `deviceToken` (public key hex) and resolved topic list.

## Examples

**Subscribe** (terminal 1):

```bash
bun run examples/subscribe.ts sports,news
```

The subscriber prints its public key hex on connect — use that as the `deviceToken` when pushing.

**Push to device** (terminal 2):

```bash
bun run examples/publish.ts token <pubkey-hex> "Hello" "World"
```

**Broadcast to topic** (terminal 2):

```bash
bun run examples/publish.ts topic sports "Goal!" "2-1"
```

The `publish.ts` script respects `PUSH_SECRET` and `SERVER_URL` env vars.

## Project Structure

```
index.ts              # Fastify server, route handlers
src/
  types.ts            # Shared TypeScript interfaces
  registry.ts         # In-memory connection registry + topic fan-out
  auth.ts             # Ed25519 signature verification middleware
examples/
  subscribe.ts        # Example SSE subscriber client
  publish.ts          # Example push publisher
.env.example          # Environment variable template
```
