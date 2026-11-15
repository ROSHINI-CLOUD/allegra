import assert from 'node:assert/strict';
import test from 'node:test';

import { removeUntilStable, stripTags } from './htmlText.js';

test('stripTags removes ordinary tags and keeps the words', () => {
  assert.equal(stripTags('<p>Hello <b>world</b></p>'), 'Hello world');
  assert.equal(stripTags('no markup, 2 < 3'), 'no markup, 2 < 3');
  assert.equal(stripTags('<img src=x onerror=1>hi'), 'hi');
});

test('stripTags never leaves a complete tag behind, however the markup is nested', () => {
  const tricky = ['<scr<b>ipt>alert(1)</scr</b>ipt>', '<<i>b>x</<i>b>', '<<a>script>x<</a>/script>', '<scr<script>ipt>x', '<<>>', '<a<b<c>>>'];
  for (const input of tricky) {
    const out = stripTags(input);
    assert.ok(!/<[^>]+>/.test(out), `${JSON.stringify(input)} left a tag in ${JSON.stringify(out)}`);
  }
});

test('removeUntilStable repeats until the text stops changing, and ends', () => {
  assert.equal(removeUntilStable('((a))', /\([^()]*\)/g), '');
  assert.equal(removeUntilStable('((a)(b))', /\([^()]*\)/g), '');
  assert.equal(removeUntilStable('abc', /x/g), 'abc');
  assert.equal(removeUntilStable('', /./g), '');
});
