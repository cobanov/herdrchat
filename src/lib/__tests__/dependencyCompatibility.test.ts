import { execFileSync } from 'node:child_process';

it('keeps Expo Router, Metro assets and xcode working with patched transitive dependencies', () => {
  // A real Node process also covers the CLI/build path, not just Jest transforms.
  execFileSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const query = require('node:module').createRequire(require.resolve('expo-router/package.json'))('query-string');
    assert.equal(query.stringify({ title: 'hello world' }), 'title=hello%20world');
    assert.equal(query.parse('title=%C3%BC').title, 'ü');
    const malformed = '%E0%A4%A'.repeat(10000);
    assert.equal(typeof query.parse('title=' + malformed).title, 'string');
    const size = require('image-size').default(require('node:fs').readFileSync('assets/icon.png'));
    assert.equal(size.width, 1024);
    const uuid = require('uuid').v4();
    assert.match(uuid, /^[a-f0-9-]{36}$/);
    const project = require('xcode').project('/tmp/unused.pbxproj');
    project.hash = { project: { objects: {} } };
    assert.equal(typeof project.generateUuid(), 'string');
  `], { cwd: process.cwd(), timeout: 10000, stdio: 'pipe' });
});
