import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assetDigest, verifyTemplateAsset } from './template-assets.mjs';
test('manifest binds approved id/version/renderer to current source, font and approval bytes', () => {
  const value = verifyTemplateAsset();
  assert.equal(value.id, 'darve_compact');
  assert.match(value.approvalHash, /^[a-f0-9]{64}$/);
  assert.notEqual(value.approvalHash, value.assetHash);
});
test('source byte changes invalidate the renderer hash; line endings do not', () => {
  const read = (file) => readFileSync(new URL('../' + file, import.meta.url));
  const expected = assetDigest(read);
  assert.equal(
    assetDigest((file) =>
      file.endsWith('.css')
        ? Buffer.from(read(file).toString().replace(/\r?\n/g, '\r\n'))
        : read(file),
    ),
    expected,
  );
  assert.notEqual(
    assetDigest((file) =>
      file.endsWith('compact.css')
        ? Buffer.concat([read(file), Buffer.from('changed')])
        : read(file),
    ),
    expected,
  );
});
