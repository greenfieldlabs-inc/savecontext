import { NextRequest } from 'next/server';
import { getEventsSince } from '@/lib/events';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const encoder = new TextEncoder();
  // Start 1 second in the past to catch very recent events
  let lastTimestamp = Date.now() - 1000;
  let running = true;

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection event
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ event: 'connected' })}\n\n`));

      // Poll for new events every 500ms
      const poll = setInterval(() => {
        if (!running) {
          clearInterval(poll);
          return;
        }
        try {
          const events = getEventsSince(lastTimestamp);
          for (const evt of events) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(evt)}\n\n`));
            lastTimestamp = evt.timestamp;
          }
        } catch {
          running = false;
          clearInterval(poll);
        }
      }, 500);

      // Heartbeat every 30s
      const heartbeat = setInterval(() => {
        if (!running) {
          clearInterval(heartbeat);
          return;
        }
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          running = false;
          clearInterval(heartbeat);
        }
      }, 30000);

      // Cleanup on client disconnect
      req.signal.addEventListener('abort', () => {
        running = false;
        clearInterval(poll);
        clearInterval(heartbeat);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
