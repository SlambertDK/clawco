// KC-0244: the pixel size of a WebP file, read from its header (lossy VP8, lossless VP8L or extended VP8X), so the width and height
// written in site/strings.js can be held equal to the files (test/site.test.ts) and the screenshot script can print them.

export function webpMaal(buf: Buffer): { width: number; height: number } {
  if (buf.length < 30 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') throw new Error('not a WebP file');
  const slags = buf.toString('latin1', 12, 16);
  if (slags === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  if (slags === 'VP8L') { const b = buf.readUInt32LE(21); return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }; }
  if (slags === 'VP8X') return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
  throw new Error(`unknown WebP chunk ${slags}`);
}
