import assert from 'node:assert/strict';
import test from 'node:test';
import {sanitizeClientErrorUrl} from '../src/lib/client-error-url.js';

test('sanitizes board share URLs before reporting client errors', () => {
  assert.equal(
    sanitizeClientErrorUrl('https://app.example.test/ja/b/share-secret-123?token=abc123&code=oauth-code#fragment'),
    '/ja/b/[redacted]'
  );
});
