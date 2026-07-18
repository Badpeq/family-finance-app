/**
 * Thin Sentry wrapper for Deno Edge Functions.
 * Uses the Sentry Envelope API directly (no SDK required).
 * Set SENTRY_DSN secret in Supabase Edge Function secrets.
 */

const DSN = Deno.env.get('SENTRY_DSN');

interface SentryExtra { [key: string]: unknown }

export async function captureException(
  err:   unknown,
  extra: SentryExtra = {},
): Promise<void> {
  if (!DSN) return;

  try {
    const parsed   = parseDsn(DSN);
    if (!parsed) return;

    const message = err instanceof Error ? err.message : String(err);
    const stack   = err instanceof Error ? err.stack : undefined;

    const event = {
      event_id:  crypto.randomUUID().replace(/-/g, ''),
      timestamp: new Date().toISOString(),
      platform:  'javascript',
      level:     'error',
      environment: Deno.env.get('SUPABASE_URL')?.includes('tsdawpxiqqnesikcqlex') ? 'production' : 'staging',
      exception: {
        values: [{
          type:       err instanceof Error ? err.constructor.name : 'Error',
          value:      message,
          stacktrace: stack ? { frames: parseStack(stack) } : undefined,
        }],
      },
      extra,
    };

    const envelope = [
      JSON.stringify({ event_id: event.event_id, dsn: DSN }),
      JSON.stringify({ type: 'event', length: JSON.stringify(event).length }),
      JSON.stringify(event),
    ].join('\n');

    await fetch(`${parsed.endpoint}/envelope/`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-sentry-envelope' },
      body:    envelope,
    });
  } catch {
    // Never throw from error reporter
  }
}

function parseDsn(dsn: string): { endpoint: string } | null {
  try {
    const url   = new URL(dsn);
    const key   = url.username;
    const host  = url.host;
    const proj  = url.pathname.replace('/', '');
    return { endpoint: `https://${key}@${host}/api/${proj}` };
  } catch {
    return null;
  }
}

function parseStack(stack: string): { filename: string; function: string; lineno?: number }[] {
  return stack.split('\n').slice(1).slice(0, 10).map(line => {
    const m = line.trim().match(/at\s+(.+?)\s+\((.+?):(\d+):\d+\)/);
    return {
      function: m?.[1] ?? '<anonymous>',
      filename: m?.[2] ?? line,
      lineno:   m ? parseInt(m[3]) : undefined,
    };
  }).reverse();
}
