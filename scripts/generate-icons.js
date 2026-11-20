"use strict";

// Draws the extension icons and writes them to icons/ as PNG files.
// Run with `npm run icons`. Uses only Node built-ins.
//
// The icon is a speech bubble (the tooltip) on a rounded square. The two
// "lines of text" in the bubble are cut-outs that show the background.

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const SIZES = [16, 48, 128];
const OUT_DIR = path.join(__dirname, "..", "icons");

// Close to the gradient of the "phrase" tag in styles.css. The tag starts
// darker so its white text has enough contrast; the icon has no text.
const GRADIENT_FROM = [0x66, 0x7e, 0xea];
const GRADIENT_TO = [0x76, 0x4b, 0xa2];
const WHITE = [255, 255, 255];

// --- Shapes, in a 0..1 coordinate space -------------------------------

function inRoundedRect(x, y, [x0, y0, x1, y1], radius) {
  const nearestX = Math.min(Math.max(x, x0 + radius), x1 - radius);
  const nearestY = Math.min(Math.max(y, y0 + radius), y1 - radius);
  return (x - nearestX) ** 2 + (y - nearestY) ** 2 <= radius ** 2;
}

function inTriangle(x, y, [ax, ay], [bx, by], [cx, cy]) {
  const side = (px, py, qx, qy) => (x - qx) * (py - qy) - (px - qx) * (y - qy);
  const d1 = side(ax, ay, bx, by);
  const d2 = side(bx, by, cx, cy);
  const d3 = side(cx, cy, ax, ay);
  const hasNegative = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPositive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNegative && hasPositive);
}

// Colour of the icon at a point, as [r, g, b] or null for transparent.
function colourAt(x, y, detailed) {
  if (!inRoundedRect(x, y, [0, 0, 1, 1], 0.22)) return null;

  const mix = (x + y) / 2;
  const background = GRADIENT_FROM.map((from, i) =>
    Math.round(from + (GRADIENT_TO[i] - from) * mix),
  );

  const inBubble =
    inRoundedRect(x, y, [0.16, 0.2, 0.84, 0.66], 0.1) ||
    inTriangle(x, y, [0.28, 0.6], [0.5, 0.6], [0.3, 0.84]);
  if (!inBubble) return background;

  // The text lines are too thin to read at 16px, so the small icon is a
  // plain bubble.
  const inTextLine =
    detailed &&
    (inRoundedRect(x, y, [0.27, 0.3, 0.73, 0.38], 0.04) ||
      inRoundedRect(x, y, [0.27, 0.47, 0.59, 0.55], 0.04));
  return inTextLine ? background : WHITE;
}

// --- Rasterising -------------------------------------------------------

// RGBA pixels for a size x size icon, anti-aliased by sampling each pixel
// on an 8 x 8 grid.
function render(size) {
  const samples = 8;
  const pixels = Buffer.alloc(size * size * 4);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let covered = 0;

      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const x = (px + (sx + 0.5) / samples) / size;
          const y = (py + (sy + 0.5) / samples) / size;
          const colour = colourAt(x, y, size >= 32);
          if (!colour) continue;
          red += colour[0];
          green += colour[1];
          blue += colour[2];
          covered++;
        }
      }

      const offset = (py * size + px) * 4;
      if (covered > 0) {
        pixels[offset] = Math.round(red / covered);
        pixels[offset + 1] = Math.round(green / covered);
        pixels[offset + 2] = Math.round(blue / covered);
      }
      pixels[offset + 3] = Math.round((covered / (samples * samples)) * 255);
    }
  }
  return pixels;
}

// --- PNG encoding ------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, checksum]);
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); // width
  header.writeUInt32BE(size, 4); // height
  header[8] = 8; // bits per channel
  header[9] = 6; // colour type: RGBA
  // bytes 10-12: default compression, filter and no interlacing

  // Each row is prefixed with filter type 0 (none).
  const rowLength = size * 4;
  const raw = Buffer.alloc((rowLength + 1) * size);
  for (let row = 0; row < size; row++) {
    pixels.copy(raw, row * (rowLength + 1) + 1, row * rowLength, (row + 1) * rowLength);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// -----------------------------------------------------------------------

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = path.join(OUT_DIR, `icon${size}.png`);
  fs.writeFileSync(file, encodePng(size, render(size)));
  console.log(`wrote ${path.relative(process.cwd(), file)}`);
}
