import { StringDecoder } from 'node:string_decoder';

// Guacamole lengths count Unicode code points, not UTF-8 bytes or UTF-16 units.
export function instruction(...values) {
  return values.map(value => {
    const text = String(value);
    return `${Array.from(text).length}.${text}`;
  }).join(',') + ';';
}

export class InstructionParser {
  decoder = new StringDecoder('utf8');
  buffer = '';
  offset = 0;
  elements = [];
  remaining = -1;
  start = 0;
  end = 0;
  constructor(onInstruction, limit = 8 * 1024 * 1024) {
    this.onInstruction = onInstruction;
    this.limit = limit;
  }
  receive(chunk) {
    const input = typeof chunk === 'string' ? chunk : this.decoder.write(chunk);
    const previousLength = this.buffer.length;
    this.buffer += input;
    if (this.buffer.length > this.limit) throw new Error('Guacamole instruction too large');
    let consumed = 0;
    while (this.offset < this.buffer.length) {
      if (this.remaining < 0) {
        const dot = this.buffer.indexOf('.', this.offset);
        if (dot < 0) break;
        const prefix = this.buffer.slice(this.offset, dot);
        if (!/^\d{1,8}$/.test(prefix)) throw new Error('Invalid Guacamole length');
        this.remaining = Number(prefix);
        if (this.remaining > this.limit) throw new Error('Guacamole element too large');
        this.start = this.end = dot + 1;
      }
      // Resume incomplete elements instead of rescanning large image blobs.
      while (this.remaining && this.end < this.buffer.length) {
        // Read new data directly so concatenated strings need not be copied on every chunk.
        const point = this.end >= previousLength
          ? input.codePointAt(this.end - previousLength) : this.buffer.codePointAt(this.end);
        if (point >= 0xD800 && point <= 0xDBFF && this.end + 1 === this.buffer.length) break;
        this.end += point > 0xFFFF ? 2 : 1;
        this.remaining--;
      }
      if (this.remaining || this.end >= this.buffer.length) break;
      const separator = this.end >= previousLength ? input[this.end - previousLength] : this.buffer[this.end];
      if (separator !== ',' && separator !== ';') throw new Error('Invalid Guacamole separator');
      this.elements.push(this.buffer.slice(this.start, this.end));
      this.offset = this.end + 1;
      this.remaining = -1;
      if (separator === ';') {
        const raw = this.buffer.slice(consumed, this.offset);
        const elements = this.elements;
        consumed = this.offset;
        this.elements = [];
        this.onInstruction(elements, raw);
      }
    }
    if (consumed) {
      this.buffer = this.buffer.slice(consumed);
      this.offset -= consumed;
      this.start -= consumed;
      this.end -= consumed;
    }
  }
}
