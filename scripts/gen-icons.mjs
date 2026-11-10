/**
 * Generates PNG app icons without any image library: paints the traffic-light
 * mark into a raw RGBA buffer and encodes it as PNG with Node's zlib.
 *
 *   node scripts/gen-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'public');
mkdirSync(out, { recursive: true });

function crc32(buf) {
  let c,
    crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePNG(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

function paint(size, { maskable }) {
  const px = Buffer.alloc(size * size * 4);
  const bg = hex('#0f1418');
  const body = hex('#1b232a');
  const edge = hex('#2a343c');
  const red = hex('#ff4d4d');
  const yellow = hex('#ffcc33');
  const green = hex('#3ddc84');
  const S = size / 512;
  const put = (x, y, c, a = 1) => {
    const i = (y * size + x) * 4;
    px[i] = Math.round(px[i] * (1 - a) + c[0] * a);
    px[i + 1] = Math.round(px[i + 1] * (1 - a) + c[1] * a);
    px[i + 2] = Math.round(px[i + 2] * (1 - a) + c[2] * a);
    px[i + 3] = 255;
  };
  const inRoundRect = (x, y, rx, ry, w, h, r) => {
    const cx = Math.max(rx + r, Math.min(rx + w - r, x));
    const cy = Math.max(ry + r, Math.min(ry + h - r, y));
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
  const cornerR = maskable ? 0 : 104 * S;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (!maskable && !inRoundRect(x + 0.5, y + 0.5, 0, 0, size, size, cornerR)) {
        px[i + 3] = 0;
        continue;
      }
      put(x, y, bg);
      // Housing
      const hx = 196 * S,
        hy = 76 * S,
        hw = 120 * S,
        hh = 360 * S,
        hr = 40 * S;
      if (inRoundRect(x + 0.5, y + 0.5, hx, hy, hw, hh, hr)) {
        put(x, y, inRoundRect(x + 0.5, y + 0.5, hx + 6 * S, hy + 6 * S, hw - 12 * S, hh - 12 * S, hr - 6 * S) ? body : edge);
      }
      const lamps = [
        [150, red, 0.45],
        [256, yellow, 0.45],
        [362, green, 1],
      ];
      for (const [ly, col, a] of lamps) {
        const d = Math.hypot(x + 0.5 - 256 * S, y + 0.5 - ly * S);
        if (d <= 42 * S) put(x, y, col, a);
        if (col === green && d > 55 * S && d < 61 * S) put(x, y, col, 0.5);
      }
    }
  }
  return px;
}

for (const [name, size, maskable] of [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['apple-touch-icon.png', 180, true],
]) {
  writeFileSync(join(out, name), encodePNG(size, size, paint(size, { maskable })));
  console.log('wrote', name);
}
