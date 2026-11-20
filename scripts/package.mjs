// Builds dist/<package name>-<version>.zip with what Wealthfolio installs:
// manifest.json, dist/addon.js, the READMEs, LICENSE and assets/ (if any). No source maps.
// Pure Node (zlib), so it works the same on Windows, macOS and Linux.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));

if (manifest.version !== pkg.version) {
  console.error(`manifest.json (${manifest.version}) and package.json (${pkg.version}) versions differ.`);
  process.exit(1);
}
if (!existsSync(join(root, manifest.main))) {
  console.error(`${manifest.main} not found: run "pnpm build" first.`);
  process.exit(1);
}

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const files = [
  join(root, 'manifest.json'),
  join(root, 'README.md'),
  join(root, 'README.es.md'),
  join(root, 'LICENSE'),
  ...walk(join(root, 'dist')).filter((f) => !f.endsWith('.map') && !f.endsWith('.zip')),
  ...walk(join(root, 'assets')),
].map((full) => ({ full, name: relative(root, full).split('\\').join('/') }));

// Fixed timestamp so the same sources give the same zip.
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
const UTF8_FLAG = 0x0800;

const locals = [];
const centrals = [];
let offset = 0;
for (const { full, name } of files) {
  const data = readFileSync(full);
  const compressed = deflateRawSync(data, { level: 9 });
  const nameBytes = Buffer.from(name, 'utf8');
  const crc = crc32(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(UTF8_FLAG, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt16LE(DOS_TIME, 10);
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  local.writeUInt16LE(0, 28);
  locals.push(local, nameBytes, compressed);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(UTF8_FLAG, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(DOS_TIME, 12);
  central.writeUInt16LE(DOS_DATE, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt32LE(offset, 42);
  centrals.push(central, nameBytes);

  offset += local.length + nameBytes.length + compressed.length;
}

const centralSize = centrals.reduce((sum, b) => sum + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(offset, 16);

const out = join(root, 'dist', `${pkg.name}-${pkg.version}.zip`);
writeFileSync(out, Buffer.concat([...locals, ...centrals, end]));
console.log(`${relative(root, out)}: ${files.map((f) => f.name).join(', ')}`);
