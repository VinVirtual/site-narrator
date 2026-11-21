import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileFixes, sayable } from '../cli/lib/text.mjs';

test('built-in fixes spell out symbols', () => {
  assert.equal(sayable('20 °C'), '20 degrees Celsius');
  assert.equal(sayable('a 90° turn'), 'a 90 degrees turn');
  assert.equal(sayable('3 × 4 = 12'), '3 times 4 equals 12');
  assert.equal(sayable('open → save'), 'open, then save');
  assert.equal(sayable('“Hi,” she said — it’s fine…'), '"Hi," she said, it\'s fine...');
});

test('project fixes replace whole words only', () => {
  const fixes = compileFixes({ ROS: 'ross', SQL: 'sequel' });
  assert.equal(sayable('ROS and PROSE and ROS.', fixes), 'ross and PROSE and ross.');
  assert.equal(sayable('MySQL uses SQL', fixes), 'MySQL uses sequel');
});

test('fixes are case-sensitive and the longest written form wins', () => {
  const fixes = compileFixes({ JS: 'jay ess', 'Node.js': 'node jay ess', 'C++': 'C plus plus' });
  assert.equal(sayable('Node.js is JS, not js or C++.', fixes), 'node jay ess is jay ess, not js or C plus plus.');
});

test('a project fix can override a built-in one', () => {
  assert.equal(sayable('5 × 5', compileFixes({ '×': ' by ' })), '5 by 5');
});

test('replacement text is used literally', () => {
  assert.equal(sayable('cost: USD', compileFixes({ USD: '$& dollars' })), 'cost: $& dollars');
});

test('white space is folded and no space is left before punctuation', () => {
  assert.equal(sayable('a  →  b .'), 'a, then b.');
});

test('a bad "say" table is refused with a clear message', () => {
  assert.throws(() => compileFixes(['a']), /"say" must be an object/);
  assert.throws(() => compileFixes({ a: 3 }), /must map non-empty text to a string/);
});
