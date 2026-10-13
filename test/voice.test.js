import test from 'node:test';
import assert from 'node:assert/strict';
import { clipToMessages, VoiceAssembler, validVoiceMessage } from '../public/js/voice.js';

const clip = (n, type = 'audio/webm;codecs=opus') => {
  const bytes = new Uint8Array(n);
  for (let i = 0; i < n; i++) bytes[i] = (i * 31 + 7) & 255;
  return new Blob([bytes], { type });
};

test('clips survive chunking and reassembly, in any order', async () => {
  const original = clip(40000);
  const msgs = await clipToMessages(original, 'p1');
  assert.ok(msgs.length > 1);
  assert.ok(msgs.every(validVoiceMessage));
  const asm = new VoiceAssembler();
  let out = null;
  for (const m of [...msgs].reverse()) out = asm.add(JSON.parse(JSON.stringify(m))) || out;
  assert.ok(out);
  assert.equal(out.from, 'p1');
  assert.equal(out.blob.type, 'audio/webm;codecs=opus');
  assert.deepEqual(new Uint8Array(await out.blob.arrayBuffer()), new Uint8Array(await original.arrayBuffer()));
});

test('bad voice messages are rejected', async () => {
  const [m] = await clipToMessages(clip(100), 'p1');
  assert.equal(validVoiceMessage({ ...m, mime: 'text/html' }), false);
  assert.equal(validVoiceMessage({ ...m, total: 1000 }), false);
  assert.equal(validVoiceMessage({ ...m, seq: 5 }), false);
  assert.equal(validVoiceMessage({ ...m, data: 'x'.repeat(100000) }), false);
  assert.equal(new VoiceAssembler().add({ ...m, mime: 'application/x-evil' }), null);
  assert.deepEqual(await clipToMessages(clip(2 * 1024 * 1024), 'p1'), [], 'too long clips are not sent');
});

test('duplicate chunks do not complete a clip early', async () => {
  const msgs = await clipToMessages(clip(30000), 'p2');
  const asm = new VoiceAssembler();
  assert.equal(asm.add(msgs[0]), null);
  assert.equal(asm.add(msgs[0]), null);
  let out = null;
  for (const m of msgs.slice(1)) out = asm.add(m) || out;
  assert.ok(out);
  assert.equal(out.blob.size, 30000);
});
