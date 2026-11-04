import { crc32 } from "node:zlib";
import { isResearchPlanInput } from '@/lib/research/planReference';

/** Small bounded UTF-8 ZIP (stored entries). Fixed timestamps/order make exports
 * reproducible. Only the in-memory allowlisted bundle is accepted, never paths. */
export function bundleZip(files: Readonly<Record<string, string>>): Buffer {
  const locals: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    if (!/^[a-zA-Z0-9_./-]+$/.test(name) || name.startsWith("/") || name.split("/").some(p => !p || p === "." || p === "..")) throw new Error("Invalid bundle entry");
    const filename = Buffer.from(`bughunter-research/${name}`), data = Buffer.from(content);
    if (data.length > 4_000_000 || offset + data.length > 16_000_000) throw new Error("Export too large");
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(33, 12); // 1980-01-01; no invented capture date
    local.writeUInt32LE(checksum, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50); header.writeUInt16LE(3 << 8 | 20, 4); header.writeUInt16LE(20, 6); header.writeUInt16LE(0x800, 8); header.writeUInt16LE(33, 14);
    header.writeUInt32LE(((isResearchPlanInput(name) ? 0o100440 : 0o100644) << 16) >>> 0, 38);
    header.writeUInt32LE(checksum, 16); header.writeUInt32LE(data.length, 20); header.writeUInt32LE(data.length, 24); header.writeUInt16LE(filename.length, 28); header.writeUInt32LE(offset, 42);
    locals.push(local, filename, data); central.push(header, filename);
    offset += local.length + filename.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
