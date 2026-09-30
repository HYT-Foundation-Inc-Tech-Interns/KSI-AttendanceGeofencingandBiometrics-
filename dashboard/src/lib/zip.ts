/*
 * A minimal ZIP writer, store-only (no compression).
 *
 * Why hand-rolled rather than a dependency: the payload is a handful of JPEGs,
 * and JPEG is already a compressed format, so DEFLATE would buy a fraction of a
 * percent for a new library in the bundle. A store-only archive is a
 * well-specified format -- a local header per entry, a central directory, an
 * end record -- and roughly the amount of code below.
 *
 * The format does not tolerate improvisation, so the details that matter:
 *
 *  - Bit 11 of the general-purpose flags is set, which is what tells a reader
 *    the entry name is UTF-8. Without it, an accented employee name in a
 *    filename is decoded as CP437 and arrives mangled.
 *  - CRC-32 is required even with no compression. Readers verify it and many
 *    (Windows Explorer among them) refuse the archive when it is wrong.
 *  - Offsets in the central directory are absolute from the start of the file,
 *    not relative to anything.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** MS-DOS date and time, as ZIP has stored them since 1989. */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time:
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      (Math.floor(date.getSeconds() / 2) & 0x1f),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

export interface ZipEntry {
  /** Path inside the archive. Forward slashes; no leading slash. */
  name: string;
  data: Uint8Array;
}

const LOCAL_HEADER_SIG = 0x04034b50;
const CENTRAL_HEADER_SIG = 0x02014b50;
const END_RECORD_SIG = 0x06054b50;
/** Bit 11: the entry name is UTF-8. */
const FLAG_UTF8 = 0x0800;

/**
 * Build a ZIP archive. Entries are stored uncompressed.
 *
 * The archive is assembled into one buffer rather than a list of Blob parts:
 * TypeScript 5.7 narrowed `Uint8Array` to `Uint8Array<ArrayBufferLike>`, which
 * no longer satisfies `BlobPart`, so a list of typed arrays would need a cast
 * at the Blob. Allocating once avoids that and is clearer about the layout,
 * since ZIP is fundamentally a byte-for-byte format.
 */
export function createZip(entries: ZipEntry[], now: Date = new Date()): Blob {
  const encoder = new TextEncoder();
  const { time, date } = dosDateTime(now);

  const prepared = entries.map((entry) => ({
    nameBytes: encoder.encode(entry.name),
    data: entry.data,
    crc: crc32(entry.data),
  }));

  const localSize = prepared.reduce(
    (sum, entry) => sum + 30 + entry.nameBytes.length + entry.data.length,
    0
  );
  const centralSize = prepared.reduce(
    (sum, entry) => sum + 46 + entry.nameBytes.length,
    0
  );

  const archive = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(archive.buffer);

  let localOffset = 0;
  const centralOffsets: number[] = [];

  for (const entry of prepared) {
    centralOffsets.push(localOffset);

    view.setUint32(localOffset, LOCAL_HEADER_SIG, true);
    view.setUint16(localOffset + 4, 20, true); // version needed
    view.setUint16(localOffset + 6, FLAG_UTF8, true);
    view.setUint16(localOffset + 8, 0, true); // method 0 = stored
    view.setUint16(localOffset + 10, time, true);
    view.setUint16(localOffset + 12, date, true);
    view.setUint32(localOffset + 14, entry.crc, true);
    view.setUint32(localOffset + 18, entry.data.length, true); // compressed size
    view.setUint32(localOffset + 22, entry.data.length, true); // uncompressed size
    view.setUint16(localOffset + 26, entry.nameBytes.length, true);
    view.setUint16(localOffset + 28, 0, true); // extra field length
    archive.set(entry.nameBytes, localOffset + 30);
    archive.set(entry.data, localOffset + 30 + entry.nameBytes.length);

    localOffset += 30 + entry.nameBytes.length + entry.data.length;
  }

  let centralOffset = localOffset;
  const centralStart = localOffset;

  prepared.forEach((entry, index) => {
    view.setUint32(centralOffset, CENTRAL_HEADER_SIG, true);
    view.setUint16(centralOffset + 4, 20, true); // version made by
    view.setUint16(centralOffset + 6, 20, true); // version needed
    view.setUint16(centralOffset + 8, FLAG_UTF8, true);
    view.setUint16(centralOffset + 10, 0, true);
    view.setUint16(centralOffset + 12, time, true);
    view.setUint16(centralOffset + 14, date, true);
    view.setUint32(centralOffset + 16, entry.crc, true);
    view.setUint32(centralOffset + 20, entry.data.length, true);
    view.setUint32(centralOffset + 24, entry.data.length, true);
    view.setUint16(centralOffset + 28, entry.nameBytes.length, true);
    view.setUint16(centralOffset + 30, 0, true); // extra
    view.setUint16(centralOffset + 32, 0, true); // comment
    view.setUint16(centralOffset + 34, 0, true); // disk number start
    view.setUint16(centralOffset + 36, 0, true); // internal attributes
    view.setUint32(centralOffset + 38, 0, true); // external attributes
    view.setUint32(centralOffset + 42, centralOffsets[index], true);
    archive.set(entry.nameBytes, centralOffset + 46);

    centralOffset += 46 + entry.nameBytes.length;
  });

  view.setUint32(centralOffset, END_RECORD_SIG, true);
  view.setUint16(centralOffset + 4, 0, true); // this disk
  view.setUint16(centralOffset + 6, 0, true); // disk with the central directory
  view.setUint16(centralOffset + 8, prepared.length, true);
  view.setUint16(centralOffset + 10, prepared.length, true);
  view.setUint32(centralOffset + 12, centralSize, true);
  view.setUint32(centralOffset + 16, centralStart, true);
  view.setUint16(centralOffset + 20, 0, true); // comment length

  return new Blob([archive], { type: 'application/zip' });
}

/**
 * Decode a `data:image/...;base64,...` URL into bytes.
 *
 * Returns null for anything that is not a base64 image data URL, so a caller
 * can skip a row instead of writing a corrupt file.
 */
export function dataUrlToBytes(dataUrl: string | null | undefined): Uint8Array | null {
  if (!dataUrl) return null;

  const comma = dataUrl.indexOf(',');
  if (comma < 0) return null;

  const meta = dataUrl.slice(0, comma);
  if (!meta.startsWith('data:image/') || !meta.includes('base64')) return null;

  try {
    const binary = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

/** Extension for a base64 image data URL, defaulting to jpg. */
export function dataUrlExtension(dataUrl: string): string {
  const meta = dataUrl.slice(0, dataUrl.indexOf(','));
  if (meta.includes('image/png')) return 'png';
  if (meta.includes('image/webp')) return 'webp';
  return 'jpg';
}

/**
 * Hand a generated Blob to the browser as a download.
 *
 * The anchor is attached to the document before clicking because Firefox
 * ignores a click on a detached node.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
