import assert from 'node:assert/strict'
import test from 'node:test'
import { gdriveDirectDownloadLink, getFileId, publicChatDownloadUrl } from './gdriveShareUrls'

void test('Google Drive links resolve to anonymous download URLs without a server API key', () => {
  const source =
    'https://drive.google.com/file/d/public-file_123/view?usp=sharing&resourcekey=0-test-key'
  assert.equal(getFileId(source), 'public-file_123')
  assert.equal(
    publicChatDownloadUrl(source),
    'https://drive.google.com/uc?export=download&id=public-file_123&resourcekey=0-test-key',
  )
  assert.equal(
    gdriveDirectDownloadLink('https://drive.google.com/open?id=public-file_123'),
    'https://drive.google.com/uc?export=download&id=public-file_123',
  )
})

void test('Non-Drive public document URLs are passed through unchanged', () => {
  const gist = 'https://gist.githubusercontent.com/example/public/raw/chat.md'
  assert.equal(publicChatDownloadUrl(gist), gist)
  const s3 = 'https://bucket.example.com/public/chat.md?versionId=2'
  assert.equal(publicChatDownloadUrl(s3), s3)
})

void test('Google Drive URL parsing rejects untrusted hosts and non-file links', () => {
  for (const source of [
    'https://drive.google.com.evil.example/file/d/abc/view',
    'http://drive.google.com/file/d/abc/view',
    'https://drive.google.com/drive/folders/abc',
    'https://drive.google.com/file/d/%2Fetc/view',
  ]) {
    assert.throws(() => gdriveDirectDownloadLink(source))
  }
})
