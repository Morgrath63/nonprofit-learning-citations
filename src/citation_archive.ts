import { z } from 'zod';

export const noteBody = z.object({
  noteId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  purpose: z.enum(['donor_receipt', 'volunteer_reminder', 'campaign_report']),
  query: z.string().min(3).max(500),
  context: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('donor_receipt'), donorName: z.string().min(1), amountCents: z.number().int().positive() }).strict(),
    z.object({ kind: z.literal('volunteer_reminder'), activity: z.string().min(1), startsAt: z.string().datetime() }).strict(),
    z.object({ kind: z.literal('campaign_report'), campaign: z.string().min(1), learnersReached: z.number().int().nonnegative() }).strict()
  ])
}).strict().refine(value => value.purpose === value.context.kind, { message: 'Purpose must match context' });

export type Citation = { url: string; title: string };
export function dedupeCitations(sources: Citation[]): Citation[] {
  const seen = new Set<string>();
  return sources.filter(source => {
    const url = new URL(source.url);
    url.hash = '';
    for (const key of Array.from(url.searchParams.keys())) {
      if (key.startsWith('utm_')) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    const identity = url.toString();
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

export class InfraiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
export function createArchiveClient(key: string, baseURL: string) {
  async function request<T>(path: string, body: unknown, retryable = true): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = await fetch(`${baseURL}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const envelope = await response.json() as { ok: boolean; data: T; error?: { code?: string; message?: string }; metadata?: unknown };
      if (response.status === 429 && retryable && attempt < 3) {
        const header = response.headers.get('retry-after');
        const seconds = header === null ? NaN : Number(header);
        const wait = header === null ? 500 * 2 ** attempt : Number.isFinite(seconds) ? seconds * 1000 : Math.max(0, Date.parse(header) - Date.now());
        await delay(Number.isFinite(wait) ? wait : 500 * 2 ** attempt);
        continue;
      }
      if (!envelope.ok) throw new InfraiError(envelope.error?.message ?? envelope.error?.code ?? 'Request rejected', response.status);
      if (!response.ok) throw new InfraiError('Request could not complete', response.status);
      return envelope.data;
    }
    throw new Error('Retry budget exhausted');
  }
  return {
    async createBucket(name: string) {
      await request('/v1/storage/bucket/create', { name }, false);
    },
    async collect(note: z.infer<typeof noteBody>, bucket: string) {
      const results = await request<{ results: Citation[] }>('/v1/web/search', { query: note.query, max_results: 8 });
      const citations = dedupeCitations(results.results);
      const archived = [];
      for (const [index, citation] of citations.entries()) {
        const source = await request<unknown>('/v1/web/scrape', { url: citation.url, format: 'markdown' });
        const objectKey = `${note.noteId}/source-${index + 1}.json`;
        const payload = JSON.stringify({ citation, source });
        const signed = await request<{ url: string }>(`/v1/storage/object/presign/${encodeURIComponent(bucket)}/${encodeURIComponent(objectKey)}`, {
          op: 'put', expires_seconds: 600, content_type: 'application/json',
          idempotency_key: `${note.noteId}-source-${index + 1}`
        });
        for (let attempt = 0; attempt < 4; attempt++) {
          const uploaded = await fetch(signed.url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: payload });
          if (uploaded.status === 429 && attempt < 3) {
            const retryAfter = uploaded.headers.get('retry-after');
            const seconds = retryAfter === null ? NaN : Number(retryAfter);
            const wait = retryAfter === null ? NaN : Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
            await delay(Number.isFinite(wait) ? Math.max(0, wait) : 500 * 2 ** attempt);
            continue;
          }
          if (!uploaded.ok) throw new InfraiError('Archive upload could not complete', uploaded.status);
          break;
        }
        archived.push({ ...citation, archiveKey: objectKey });
      }
      return { noteId: note.noteId, purpose: note.purpose, context: note.context, citations: archived, collected: results.results.length, duplicatesRemoved: results.results.length - citations.length };
    }
  };
}
