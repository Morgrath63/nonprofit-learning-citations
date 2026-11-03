import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupeCitations, noteBody } from '../src/citation_archive.ts';

test('one reading survives tracking links while a different page remains', () => {
  const sources = [
    { title: 'Reading one', url: 'https://example.org/reading?utm_source=class#intro' },
    { title: 'Reading one again', url: 'https://example.org/reading' },
    { title: 'Another reading', url: 'https://example.org/other' }
  ];
  assert.deepEqual(dedupeCitations(sources), [sources[0], sources[2]]);
});

test('a receipt cannot silently become a volunteer reminder', () => {
  assert.equal(noteBody.safeParse({ noteId: 'lesson-1', query: 'learning outcomes', purpose: 'donor_receipt', context: { kind: 'volunteer_reminder', activity: 'Tutoring', startsAt: '2026-11-03T10:00:00Z' } }).success, false);
});
