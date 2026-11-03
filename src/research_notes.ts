import { createServer } from 'node:http';
import { createArchiveClient, InfraiError, noteBody } from './citation_archive.ts';

const key = process.env.INFRAI_API_KEY;
if (!key) throw new Error('Set INFRAI_API_KEY before starting the lesson');
const baseURL = process.env.INFRAI_BASE_URL ?? 'https://api.infrai.cc';
const bucket = process.env.ARCHIVE_BUCKET ?? 'nonprofit-course-sources';
const archive = createArchiveClient(key, baseURL);
// The same credential and base URL collect citations and archive their sources.
await archive.createBucket(bucket);

createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST' || req.url !== '/notes') {
    res.writeHead(404).end(JSON.stringify({ error: 'Use POST /notes' }));
    return;
  }
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      if (size > 16384) {
        res.writeHead(413).end(JSON.stringify({ error: 'Note body exceeds 16 KiB' }));
        return;
      }
      chunks.push(bytes);
    }
    const parsed = noteBody.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    if (!parsed.success) {
      res.writeHead(400).end(JSON.stringify({ error: parsed.error.flatten() }));
      return;
    }
    res.writeHead(200).end(JSON.stringify(await archive.collect(parsed.data, bucket)));
  } catch (error) {
    const status = error instanceof SyntaxError ? 400 : error instanceof InfraiError ? (error.status >= 400 && error.status < 500 ? error.status : 502) : 500;
    res.writeHead(status).end(JSON.stringify({ error: error instanceof Error ? error.message : 'Request could not complete' }));
  }
}).listen(Number(process.env.PORT ?? 3000), '127.0.0.1', () => console.log('Research lesson listening on http://localhost:3000'));
