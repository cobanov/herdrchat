import { cacheStamp, TRANSCRIPT_CACHE_VERSION } from '../transcript/cacheVersion';

// Rows cached by the parser before task notifications were read have no
// notice segments, so a background card in an unchanged transcript showed
// "running" until the transcript changed. Bumping the version re-reads them.
it('stamps cached rows with the parser version, so an older parser\'s rows read as another session\'s', () => {
  expect(TRANSCRIPT_CACHE_VERSION).toBe(2);
  expect(cacheStamp('sess-a')).toBe('v2|sess-a');
  // What every row carried before there was a version.
  expect(cacheStamp('sess-a', 1)).toBe('sess-a');
  expect(cacheStamp('sess-a')).not.toBe(cacheStamp('sess-a', 1));
  expect(cacheStamp('sess-a')).not.toBe(cacheStamp('sess-b'));
});
