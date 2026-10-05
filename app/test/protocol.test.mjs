import test from 'node:test';
import assert from 'node:assert/strict';
import { instruction, InstructionParser } from '../src/server/guacamole/protocol.mjs';

test('parses streamed UTF-8 with Japanese, emoji, and delimiters in values', () => {
  const expected = ['name', '日本語🖥️,;.' ];
  const raw = instruction(...expected) + instruction('sync', 12345);
  const parsed = [];
  const parser = new InstructionParser((parts, original) => parsed.push({ parts, original }));
  for (const byte of Buffer.from(raw)) parser.receive(Buffer.from([byte]));
  assert.deepEqual(parsed.map(item => item.parts), [expected, ['sync', '12345']]);
  assert.equal(parsed[0].original, instruction(...expected));
});
test('handles concatenated instructions and split UTF-16 surrogate pairs', () => {
  const parsed = [];
  const parser = new InstructionParser(parts => parsed.push(parts));
  parser.receive('4.name,1.\ud83d');
  parser.receive('\ude00;0.,4.ping,1.1;');
  assert.deepEqual(parsed, [['name', '😀'], ['', 'ping', '1']]);
});
test('rejects malformed and excessive instructions', () => {
  for (const raw of ['x.key;', '3.key:', '99999999.a;']) {
    assert.throws(() => new InstructionParser(() => {}).receive(raw));
  }
  assert.throws(() => new InstructionParser(() => {}, 10).receive('abcdefghijk'));
});

test('preserves instructions across every UTF-8 and UTF-16 split boundary', () => {
  const expected = [['name', '日本語😀,;.'], ['sync', '123'], ['', ''], ['name', '終🖥️']];
  const raw = expected.map(parts => instruction(...parts)).join('');
  for (const input of [raw, Buffer.from(raw)]) {
    for (let split = 0; split <= input.length; split++) {
      const parsed = [];
      const parser = new InstructionParser((parts, original) => parsed.push({ parts, original }));
      parser.receive(input.slice(0, split));
      parser.receive(input.slice(split));
      assert.deepEqual(parsed.map(item => item.parts), expected);
      assert.equal(parsed.map(item => item.original).join(''), raw);
      assert.equal(parser.buffer, '');
    }
  }
});

test('resumes large fragmented image elements and bounds unfinished instructions', () => {
  const expected = ['blob', '1', 'A'.repeat(1024 * 1024)];
  const raw = Buffer.from(instruction('sync', 1) + instruction(...expected) + instruction('sync', 2));
  const parsed = [];
  const parser = new InstructionParser(parts => parsed.push(parts));
  for (let offset = 0; offset < raw.length; offset += 4096) parser.receive(raw.subarray(offset, offset + 4096));
  assert.deepEqual(parsed, [['sync', '1'], expected, ['sync', '2']]);
  const limited = new InstructionParser(() => {}, 16);
  limited.receive('16.abcdefgh');
  assert.throws(() => limited.receive('ijklmnop;'), /too large/);
});
