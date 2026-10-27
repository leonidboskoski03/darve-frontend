import { describe, expect, it } from 'vitest';
import { createSseParser, type SseFrame } from './sse-parser';

describe('bounded incremental SSE framing', () => {
  it('handles UTF-8 byte boundaries, BOM, CR/LF splits, comments and multiple data lines', () => {
    const frames: SseFrame[] = [],
      delays: number[] = [];
    const parser = createSseParser(
      (frame) => frames.push(frame),
      (retry) => delays.push(retry),
    );
    const bytes = new TextEncoder().encode(
      '\uFEFF: ignored\r\nretry: 2000\r\nid: cursor\revent: update\rdata: 散歩\r\ndata: two\n\n',
    );
    for (const byte of bytes) parser.push(new Uint8Array([byte]));
    expect(frames).toEqual([{ id: 'cursor', event: 'update', data: '散歩\ntwo' }]);
    expect(delays).toEqual([2000]);
  });
  it('follows id persistence/reset and ignores unknown fields, invalid retry and null ids', () => {
    const frames: SseFrame[] = [],
      delays: number[] = [];
    const parser = createSseParser(
      (frame) => frames.push(frame),
      (value) => delays.push(value),
    );
    parser.push(
      new TextEncoder().encode(
        'id: one\ndata: a\n\nid: bad\0\nunknown: x\nretry: -1\nretry: 1.5\ndata: b\n\nid:\ndata: c\n\n',
      ),
    );
    expect(frames.map((f) => f.id)).toEqual(['one', 'one', '']);
    expect(delays).toEqual([]);
  });
  it('does not dispatch a partially received event at EOF', () => {
    const frames: SseFrame[] = [];
    const parser = createSseParser(
      (frame) => frames.push(frame),
      () => {},
    );
    parser.push(new TextEncoder().encode('data: private-incomplete\n'));
    parser.end();
    expect(frames).toEqual([]);
  });
  it('bounds lines and accumulated event data, including many small lines', () => {
    const parser = () =>
      createSseParser(
        () => {},
        () => {},
        32,
      );
    expect(() => parser().push(new TextEncoder().encode('x'.repeat(33)))).toThrow('SSE_LINE_LIMIT');
    expect(() => parser().push(new TextEncoder().encode('data: 12345678\n'.repeat(4)))).toThrow(
      'SSE_FRAME_LIMIT',
    );
  });
  it('rejects invalid and incomplete UTF-8 without publishing raw bytes', () => {
    const parser = createSseParser(
      () => {},
      () => {},
    );
    expect(() => parser.push(new Uint8Array([255]))).toThrow();
    const partial = createSseParser(
      () => {},
      () => {},
    );
    partial.push(new Uint8Array([0xe2]));
    expect(() => partial.end()).toThrow();
  });
});
