export type SseFrame = { event: string; data: string; id: string };

/** Incremental UTF-8 SSE framing. Retains at most one bounded line/event, never event history. */
export function createSseParser(
  onFrame: (frame: SseFrame) => void,
  onRetry: (milliseconds: number) => void,
  limit = 262_144,
) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let line = '',
    data = '',
    event = '',
    id = '',
    skipLf = false,
    size = 0;
  const consume = () => {
    const value = line;
    line = '';
    if (value === '') {
      if (data !== '') onFrame({ event: event || 'message', data: data.slice(0, -1), id });
      data = '';
      event = '';
      size = 0;
      return;
    }
    if (value.startsWith(':')) return;
    size += value.length;
    if (size > limit) throw new Error('SSE_FRAME_LIMIT');
    const separator = value.indexOf(':');
    const field = separator < 0 ? value : value.slice(0, separator);
    let content = separator < 0 ? '' : value.slice(separator + 1);
    if (content.startsWith(' ')) content = content.slice(1);
    if (field === 'data') data += content + '\n';
    else if (field === 'event') event = content;
    else if (field === 'id' && !content.includes('\0')) id = content;
    else if (field === 'retry' && /^[0-9]+$/.test(content)) {
      const retry = Number(content);
      if (Number.isSafeInteger(retry)) onRetry(retry);
    }
  };
  return {
    push(chunk: Uint8Array) {
      // Decode slices so even one unusually large network chunk cannot create a huge text buffer.
      for (let offset = 0; offset < chunk.length; offset += 4096) {
        for (const character of decoder.decode(chunk.subarray(offset, offset + 4096), {
          stream: true,
        })) {
          if (skipLf) {
            skipLf = false;
            if (character === '\n') continue;
          }
          if (character === '\r' || character === '\n') {
            consume();
            skipLf = character === '\r';
          } else {
            line += character;
            if (line.length > limit) throw new Error('SSE_LINE_LIMIT');
          }
        }
      }
    },
    end() {
      decoder.decode(); // Reject incomplete UTF-8. An unterminated event is never dispatched.
      line = '';
      data = '';
      event = '';
      size = 0;
    },
  };
}
