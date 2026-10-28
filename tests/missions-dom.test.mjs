import assert from 'node:assert/strict';
import math, { makeProblem, checkAnswer } from '../js/missions/math.js';
import memory, { makePattern, checkTap } from '../js/missions/memory.js';
import typing, { normalize, matches, pickPhrases, SHORT, LONG } from '../js/missions/typing.js';

for (const d of ['easy', 'medium', 'hard', 'insane']) {
  for (let i = 0; i < 500; i++) {
    const p = makeProblem(d);
    assert.ok(Number.isInteger(p.answer) && Math.abs(p.answer) < 1e5, `${d}: ${p.text}`);
    if (d === 'easy') assert.ok(p.answer >= 0);
    assert.ok(checkAnswer(p, String(p.answer)));
    assert.ok(!checkAnswer(p, String(p.answer + 1)));
  }
}
assert.equal(checkAnswer({ answer: -5 }, '-5'), true);
assert.equal(checkAnswer({ answer: 5 }, ''), false);
assert.equal(checkAnswer({ answer: 5 }, '-'), false);
assert.equal(checkAnswer({ answer: 5 }, '5.0'), false);

for (const size of [3, 4, 5]) {
  const p = makePattern(size, 5);
  assert.equal(p.size, 5); assert.ok([...p].every(i => i >= 0 && i < size * size));
}
assert.equal(makePattern(3, 99).size, 8);
const pat = new Set([1, 2, 3]);
assert.equal(checkTap(pat, new Set(), 0), 'wrong');
assert.equal(checkTap(pat, new Set([1]), 2), 'correct');
assert.equal(checkTap(pat, new Set([1, 2]), 3), 'complete');
assert.equal(checkTap(pat, new Set([3, 2]), 1), 'complete');

assert.equal(normalize('  It’s   A “Test”  '), `it's a "test"`);
assert.ok(matches("I'm awake", 'i’m AWAKE '));
assert.ok(!matches('rise and shine', 'rise and shin'));
assert.equal(pickPhrases(2, 'long').length, 2);
assert.equal(pickPhrases(20, 'short').length, 20);
assert.ok(pickPhrases(3, 'long').every(x => LONG.includes(x)));
assert.ok(SHORT.length + LONG.length >= 30);
for (const m of [math, memory, typing]) {
  assert.ok(m.id && m.name && m.icon && typeof m.mount === 'function' && m.settings.length);
}
console.log('missions tests passed');
