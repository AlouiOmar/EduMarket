import type { Response } from 'express';

const streams = new Map<string, Set<Response>>();

export function subscribeUserEvents(userId: string, response: Response) {
  const listeners = streams.get(userId) || new Set<Response>();
  listeners.add(response);
  streams.set(userId, listeners);
  response.write('retry: 5000\n: connected\n\n');
  const heartbeat = setInterval(() => {
    if (!response.writableEnded && !response.destroyed) response.write(': keepalive\n\n');
  }, 25_000);
  const cleanup = () => {
    clearInterval(heartbeat);
    listeners.delete(response);
    if (!listeners.size) streams.delete(userId);
  };
  response.on('close', cleanup);
  return cleanup;
}

export function publishUserEvent(userIds: string[], eventName: 'message.created' | 'notification.created', payload: Record<string, string>) {
  const frame = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const userId of new Set(userIds)) {
    const listeners = streams.get(userId);
    if (!listeners) continue;
    for (const response of listeners) {
      if (response.writableEnded || response.destroyed) listeners.delete(response);
      else response.write(frame);
    }
    if (!listeners.size) streams.delete(userId);
  }
}

export function publishMessageEvent(participantIds: string[], message: { id: string; conversationId: string }) {
  publishUserEvent(participantIds, 'message.created', message);
}

export function publishNotificationEvent(userId: string, notificationId: string) {
  publishUserEvent([userId], 'notification.created', { id: notificationId });
}

export function closeUserEventStreams() {
  const responses = [...streams.values()].flatMap(listeners => [...listeners]);
  streams.clear();
  for (const response of responses) {
    if (response.writableEnded || response.destroyed) continue;
    response.write('event: server.shutdown\ndata: {}\n\n');
    response.end();
  }
}
