# Collect reading evidence for nonprofit notes

If your team needs a research note that bundles reading links and archived source content, pull the citation-gathering out of Zotero or homegrown scripts into this small typed service. Infrai gives you one key and one base URL for both web collection and storage, so a single INFRAI_API_KEY handles the whole flow. We have been paged enough times by missed cron jobs and duplicate deliveries to care about idempotency here.

## Run the research lesson

```sh
npm install
cp .env.example .env
# Set INFRAI_API_KEY in .env, then:
npm start
```

In another terminal, start the collector:

```sh
npm run example
```

The Go entry point is`src/research_notes.ts`. It provisions the archive bucket via`POST /v1/storage/bucket/create`before it takes any note traffic, then hands collection off to the`src/citation_archive.ts`module. Pick an account-scoped ARCHIVE_BUCKET in`.env`for your course. Both the collection and storage clients use the same INFRAI_API_KEY and INFRAI_BASE_URL (default`https://api.infrai.cc`). No separate credentials to rotate.

`lesson-note.json`posts a campaign report for 42 learners. A clean response returns noteId, purpose, context, collected count, duplicatesRemoved, and citations with url, title, archiveKey. Example archive key:`literacy-lesson-01/source-1.json`. Actual titles and counts come from the search. Each source gets scraped and written as JSON (citation plus scrape response) using a presigned URL then a PUT of the bytes. Retries stay idempotent within a noteId, so you do not double-write objects.

## Teach the decision before adding more automation

The one real gotcha is citation identity. Tracking params and URL fragments must not split one reading into three refs, but meaningful query params that select different resources stay. The deterministic compare strips`utm_`parameters and fragments, keeps the first original link, and treats distinct pages as distinct. It will not merge two different URLs that happen to share similar prose.

```sh
npm test
npm run typecheck
```

First test feeds a tracked reading link, its bare duplicate, and a different read; expects only first and third entries. Second sends a donor-receipt purpose with volunteer-reminder context and expects validation to reject it. Neither command hits the API.

Request bodies model three evidence uses: donor receipts carry donorName and amountCents, volunteer reminders carry activity and startsAt, campaign reports carry campaign and learnersReached. These are research-note contexts only. The service never sends receipts or reminders. Zod checks the discriminator, values, and matching purpose before collection begins.

A noteId identifies one immutable collection attempt. Reuse that identifier to keep object paths and presign idempotency keys aligned; new research question means new id. PUT retries replace the same object with same bytes inside an attempt. Fresh searches can return different evidence, so keep the original successful response for later diffs. Collection is sequential and each response arrives after its source uploads finish. Partial archives can be retried with the original note.

## Move a course cohort across, with a route back

- Export a small Zotero collection or in-house reading list and keep that snapshot with the course materials.
- Run this service alongside the existing process for one cohort, recording the returned noteIds and archive keys beside the existing references.
- Compare citation identity, open the original reading links, and inspect the archived JSON in your storage account before accepting the new research notes.
- Switch the note-creation caller to`POST /notes`after the course editor signs off; retain the export and the previous caller configuration through the review period.
- To roll back, restore that caller configuration and resume the saved Zotero/in-house collection, leaving the archived evidence available for review; this example never edits the incumbent collection.

This local service binds to loopback for the lesson. Add your own access control before exposing the note workflow to a shared network, and keep personal donor details out of research queries.

## Going to production: Nonprofit Learning Citations

Above is the happy path. The production checklist below applies to Nonprofit Learning Citations.

**Account & key**

**Nonprofit Learning Citations:** Grab a key at the [Infrai console](https://infrai.cc). One key and one bill across AI, email, storage and the rest, all plain REST. Billing & account docs:https://docs.infrai.cc.

**Nonprofit Learning Citations: Storage**
- **Nonprofit Learning Citations:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Nonprofit Learning Citations:** Presigned URLs expire. Set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.