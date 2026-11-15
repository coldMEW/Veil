import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { cloudProviders, runCloudReview } from './cloudReview.mjs';
import { combineFindings } from '../src/lib/reviewFindings.js';

function box(type, ...parts) {
  const contents = Buffer.concat(parts);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(contents.length + 8);
  header.write(type, 4, 'ascii');
  return Buffer.concat([header, contents]);
}

test('routes video and stills to the supported providers and combines their findings by time', async () => {
  const header = Buffer.alloc(20);
  header.writeUInt32BE(1000, 12);
  header.writeUInt32BE(6000, 16);
  const handler = Buffer.alloc(12);
  handler.write('vide', 8);
  const clip = Buffer.concat([
    box('ftyp', Buffer.from('isom\0\0\0\0isom')),
    box('moov', box('mvhd', header), box('trak', box('mdia', box('hdlr', handler)))),
    box('mdat', Buffer.alloc(8)),
  ]);
  const sourceSha256 = createHash('sha256').update(clip).digest('hex');
  const env = { GEMINI_API_KEY: 'test-google', HIVE_API_KEY: 'test-hive', OPENAI_API_KEY: 'test-openai' };
  const input = {
    providers: cloudProviders(env).map(({ id }) => id),
    video: clip.toString('base64'),
    sourceSha256,
    frames: [{ time: 2, thumbnail: 'data:image/jpeg;base64,/9j/2Q==' }],
  };
  const requests = [];
  const fetcher = async (url, options) => {
    requests.push(url);
    if (url.includes('googleapis.com')) {
      assert.equal(JSON.parse(options.body).contents[0].parts[0].inlineData.data, input.video);
      return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ findings: [
        { start: 1, end: 3, subject: 'door handle', location: 'left of the door', before: 'There is one metal handle.', after: 'Two handles appear on the door.' },
        { start: 7, end: 8, subject: 'door handle', location: 'left of the door', before: 'There is one metal handle.', after: 'Two handles appear on the door.' },
      ] }) }] } }] });
    }
    if (url.includes('thehive.ai')) {
      assert.deepEqual(Buffer.from(await options.body.get('media').arrayBuffer()), clip);
      return Response.json({ status: [{ response: { output: [
        { time: 2, classes: [{ class: 'ai_generated', score: 0.95 }, { class: 'deepfake', score: 0.8 }] },
        { time: 3, classes: [{ class: 'ai_generated', score: 0.99 }, { class: 'deepfake', score: 0.1 }] },
      ] } }] });
    }
    assert.equal(options.body.get('file').type, 'image/jpeg');
    assert.equal(options.body.get('file').size, 4);
    return Response.json({ results: [{ type: 'synthid', outcome: 'detected' }] });
  };
  await assert.rejects(() => runCloudReview({ ...input, sourceSha256: '0'.repeat(64) }, { env, fetcher }), /do not match/);
  assert.equal(requests.length, 0);
  const report = await runCloudReview(input, { env, fetcher });
  assert.equal(report.sourceSha256, sourceSha256);
  assert.deepEqual(report.checks.map(({ status }) => status), ['complete', 'complete', 'complete']);
  const groups = combineFindings([
    { check: 'synthetic_media_model', timeStart: 1.5, timeEnd: 2 },
    { check: 'temporal_edit', timeStart: 4, timeEnd: 4 },
  ], report.checks.flatMap(({ findings }) => findings));
  assert.equal(groups.length, 1);
  assert.equal(groups[0].findings.length, 4);
  assert.equal(groups[0].timeEnd, 3);
});
