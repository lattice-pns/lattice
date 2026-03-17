# lattice

An APNs-inspired push notification server using Server-Sent Events (SSE). Clients hold open SSE connections identified by a device token; a backend can push notifications to specific clients or broadcast to a topic.

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

| Variable           | Default                | Description                      |
| ------------------ | ---------------------- | -------------------------------- |
| `SUBSCRIBE_SECRET` | `dev-subscribe-secret` | Bearer token for SSE subscribers |
| `PUSH_SECRET`      | `dev-push-secret`      | Bearer token for push endpoints  |

## API

### `GET /`

Health check. Returns the number of active connections.

```json
{ "status": "ok", "connections": 3 }
```

### `GET /subscribe?deviceToken=&topics=`

Opens an SSE connection. Requires `Authorization: Bearer <SUBSCRIBE_SECRET>`.

| Query param   | Required | Description                            |
| ------------- | -------- | -------------------------------------- |
| `deviceToken` | Yes      | Unique client identifier               |
| `topics`      | No       | Comma-separated list of topics to join |

If a client reconnects with the same `deviceToken`, the previous connection is evicted. A `: ping` comment frame is sent every 25 seconds to keep the connection alive through proxies.

### `POST /push/token`

Push a notification to a specific device. Requires `Authorization: Bearer <PUSH_SECRET>`.

```json
{
  "deviceToken": "my-device",
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

On connect, an initial `event: connected` frame is sent with the `deviceToken` and resolved topic list.

## Examples

**Subscribe** (terminal 1):

```bash
bun run examples/subscribe.ts my-device sports,news
```

**Push to device** (terminal 2):

```bash
bun run examples/publish.ts token my-device "Hello" "World"
```

**Broadcast to topic** (terminal 2):

```bash
bun run examples/publish.ts topic sports "Goal!" "2-1"
```

Both example scripts respect `SUBSCRIBE_SECRET`, `PUSH_SECRET`, and `SERVER_URL` env vars.

## Project Structure

```
index.ts              # Fastify server, route handlers
src/
  types.ts            # Shared TypeScript interfaces
  registry.ts         # In-memory connection registry + topic fan-out
examples/
  subscribe.ts        # Example SSE subscriber client
  publish.ts          # Example push publisher
.env.example          # Environment variable template
```
