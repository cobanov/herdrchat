import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { newImageName, uploadCommands, uploadImage, UPLOAD_CHUNK_CHARS } from '../attachments/upload';
import { DemoHost } from '../demo/host';
import type { HerdrTransport } from '../herdr/transport';
import { MAX_COMMAND_BYTES } from '../herdr/socket';
import { imageName, promptWithImages, splitImages } from '../transcript/images';
import { displayText, imagePaths, isToolOnly, receiptKey } from '../transcript/message';
import { parseTranscriptLine } from '../transcript/parser';

const UPLOAD = '/Users/me/.cache/herdrchat/uploads/mf2x9a1k-3kd81zq0.jpg';

describe('pictures in a prompt', () => {
  it('sends what was typed, then one path a line', () => {
    expect(promptWithImages('  what is this?  ', [UPLOAD])).toBe(`what is this?\n\n${UPLOAD}`);
    expect(promptWithImages('', [UPLOAD, UPLOAD])).toBe(`${UPLOAD}\n${UPLOAD}`);
    expect(promptWithImages('no pictures', [])).toBe('no pictures');
  });

  it('takes the references back out, leaving exactly what was typed', () => {
    expect(splitImages(`[Image #1]what is this?`)).toEqual({ text: 'what is this?', paths: [] });
    expect(splitImages(`[Image: source: ${UPLOAD}]`)).toEqual({ text: '', paths: [UPLOAD] });
    expect(splitImages(`what is this?\n\n${UPLOAD}`)).toEqual({ text: 'what is this?', paths: [UPLOAD] });
    // A path that is not one of ours is text someone typed.
    expect(splitImages('open /tmp/screenshot.png please').paths).toEqual([]);
    expect(imageName(UPLOAD)).toBe('mf2x9a1k-3kd81zq0.jpg');
  });
});

describe('pictures in a Claude transcript', () => {
  // Measured 2026-09-26: a path sent through herdr's `agent prompt` to Claude
  // Code 2.1.x became an attachment, recorded as this one user line.
  const sent = JSON.stringify({
    type: 'user', uuid: 'u1', timestamp: '2026-09-26T02:15:00Z',
    message: { role: 'user', content: [
      { type: 'text', text: '[Image #1]What is written in this image? Reply with just the words.' },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } },
      { type: 'text', text: `[Image: source: ${UPLOAD}]` },
    ] },
  });

  it('shows the text as typed and the picture as a picture', () => {
    const message = parseTranscriptLine(sent)!;
    expect(displayText(message)).toBe('What is written in this image? Reply with just the words.');
    expect(imagePaths(message)).toEqual([UPLOAD]);
    expect(message.segments.map((segment) => segment.kind)).toEqual(['text', 'image']);
  });

  it('matches the echo of the message the phone sent', () => {
    const echo = { ...parseTranscriptLine(sent)!, id: 'local-1' };
    expect(receiptKey(parseTranscriptLine(sent)!)).toBe(receiptKey(echo));
  });

  it('keeps a picture-only message, which has no text to show', () => {
    const only = JSON.stringify({ type: 'user', uuid: 'u2', message: { role: 'user', content: [
      { type: 'text', text: '[Image #1]' },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } },
      { type: 'text', text: `[Image: source: ${UPLOAD}]` },
    ] } });
    const message = parseTranscriptLine(only)!;
    expect(displayText(message)).toBe('');
    expect(isToolOnly(message)).toBe(false);
    // Its receipt must not be any other line without text, a tool result included.
    const toolResult = parseTranscriptLine(JSON.stringify({ type: 'user', uuid: 'u3', message: { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 't', content: 'ok' },
    ] } }))!;
    expect(receiptKey(toolResult)).not.toBe(receiptKey(message));
  });

  it('shows a picture pasted into the terminal, whose path it never learns', () => {
    const pasted = JSON.stringify({ type: 'user', uuid: 'u4', message: { role: 'user', content: [
      { type: 'text', text: 'look at this' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
    ] } });
    const message = parseTranscriptLine(pasted)!;
    expect(displayText(message)).toBe('look at this');
    expect(message.segments).toContainEqual({ kind: 'image', path: '' });
  });
});

describe('pictures in a Codex transcript', () => {
  // Codex keeps the path line as typed.
  const sent = JSON.stringify({ type: 'response_item', timestamp: '2026-09-26T02:25:17Z', payload: {
    type: 'message', role: 'user',
    content: [{ type: 'input_text', text: `What is written in this image?\n\n${UPLOAD}` }],
  } });

  it('shows the text as typed and the path as a picture', () => {
    const message = parseTranscriptLine(sent)!;
    expect(displayText(message)).toBe('What is written in this image?');
    expect(imagePaths(message)).toEqual([UPLOAD]);
  });
});

describe('uploading a picture', () => {
  const bytes = Buffer.from(Array.from({ length: 250_000 }, (_, index) => (index * 7919) % 256));
  const base64 = bytes.toString('base64');

  it('names uploads so they sort by time and cannot be steered into a path', () => {
    expect(newImageName(1_790_000_000_000, () => 0.5)).toMatch(/^[a-z0-9]+-[a-z0-9]{8}\.jpg$/);
    expect(() => uploadCommands('../../.ssh/authorized_keys', base64)).toThrow();
    expect(() => uploadCommands('a.jpg', "AAAA'; rm -rf ~; '")).toThrow();
  });

  it('keeps every command under the size a host shell accepts', () => {
    const commands = uploadCommands('mf2x9a1k-3kd81zq0.jpg', base64);
    expect(commands.length).toBe(Math.ceil(base64.length / UPLOAD_CHUNK_CHARS) + 1);
    for (const command of commands) expect(Buffer.byteLength(command)).toBeLessThan(MAX_COMMAND_BYTES - 1024);
  });

  it('lands the exact bytes on a real shell and answers with the absolute path', () => {
    const home = mkdtempSync(join(tmpdir(), 'herdrchat-upload-'));
    try {
      let out = '';
      for (const command of uploadCommands('mf2x9a1k-3kd81zq0.jpg', base64)) {
        out = execFileSync('sh', ['-c', command], { env: { ...process.env, HOME: home }, encoding: 'utf8' });
      }
      const dir = join(home, '.cache/herdrchat/uploads');
      expect(out.trim()).toBe(join(dir, 'mf2x9a1k-3kd81zq0.jpg'));
      expect(readFileSync(join(dir, 'mf2x9a1k-3kd81zq0.jpg')).equals(bytes)).toBe(true);
      expect(readdirSync(dir)).toEqual(['mf2x9a1k-3kd81zq0.jpg']);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('stops at the first command the host refuses', async () => {
    const calls: string[] = [];
    const transport: HerdrTransport = {
      exec: async (command) => {
        calls.push(command);
        return calls.length === 2
          ? { ok: false, code: 'transport_failed', message: 'channel closed' }
          : { ok: true, stdout: '', stderr: '', exitCode: 0 };
      },
      streamLines: () => { throw new Error('unused'); },
    };
    const result = await uploadImage(transport, { name: 'mf2x9a1k-3kd81zq0.jpg', base64 }, 1000);
    expect(result).toEqual({ ok: false, message: 'channel closed' });
    expect(calls).toHaveLength(2);
  });
});

describe('pictures on the demo host', () => {
  it('takes an upload and answers with where a host would keep it', async () => {
    const host = new DemoHost();
    const result = await uploadImage(host, { name: 'mf2x9a1k-3kd81zq0.jpg', base64: 'AAAA' }, 1000);
    expect(result.ok && result.path.endsWith('/.cache/herdrchat/uploads/mf2x9a1k-3kd81zq0.jpg')).toBe(true);
  });
});
