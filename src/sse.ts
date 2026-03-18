import type { SseEvent } from "./types";

export function formatSseFrame(event: SseEvent): string {
  let frame = "";
  if (event.id) frame += `id: ${event.id}\n`;
  if (event.event) frame += `event: ${event.event}\n`;
  frame += `data: ${event.data}\n\n`;
  return frame;
}
