// Rebuilds a source-only MS-OVBA container. Excel compiles it when macros are enabled.
// No Excel automation or changes to macro security settings are needed.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import CFB from 'cfb';
import { compress, decompress } from './ovba.mjs';

const root = new URL('./', import.meta.url);
const baseBytes = await fs.readFile(new URL('vba-base.bin', root));
assert.equal(
  createHash('sha256').update(baseBytes).digest('hex'),
  '0ced1464b3677e98f5e3a8c5d80135e18dc98dca39299f1a8cfd2a00999fbf9f',
);
const base = CFB.read(baseBytes, { type: 'buffer' });
const dir = decompress(CFB.find(base, 'dir').content);
const marker = Buffer.from('0f00020000000500', 'hex');
const moduleStart = dir.indexOf(marker);
assert(moduleStart >= 0, 'Expected five-module base project');
let pos = moduleStart + marker.length;
assert.equal(dir.readUInt16LE(pos), 0x13); // PROJECTCOOKIE
pos += 8;
const records = [];
for (let i = 0; i < 5; i++) {
  const start = pos;
  let name;
  do {
    const id = dir.readUInt16LE(pos);
    const size = dir.readUInt32LE(pos + 2);
    if (id === 0x19) name = dir.subarray(pos + 6, pos + 6 + size).toString('latin1');
    if (id === 0x31) dir.writeUInt32LE(0, pos + 6); // no compiled module cache
    pos += 6 + size;
    if (id === 0x2b) break;
  } while (pos < dir.length);
  records.push({ name, bytes: dir.subarray(start, pos) });
}
const kept = records.filter(({ name }) => name !== 'ThisWorkbook1');
function sheetRecord(name) {
  const original = records.find((r) => r.name === 'Sheet1').bytes;
  const parts = [];
  for (let at = 0; at < original.length;) {
    const id = original.readUInt16LE(at);
    const size = original.readUInt32LE(at + 2);
    if ([0x19, 0x1a, 0x47, 0x32].includes(id)) {
      const text = Buffer.from(name, [0x47, 0x32].includes(id) ? 'utf16le' : 'latin1');
      const header = Buffer.alloc(6);
      header.writeUInt16LE(id);
      header.writeUInt32LE(text.length, 2);
      parts.push(header, text);
    } else parts.push(original.subarray(at, at + 6 + size));
    at += 6 + size;
  }
  return { name, bytes: Buffer.concat(parts) };
}
kept.push(sheetRecord('Sheet3'), sheetRecord('Sheet4'));
const prefix = Buffer.from(dir.subarray(0, moduleStart + 16));
prefix.writeUInt16LE(kept.length, moduleStart + 6);
const newDir = Buffer.concat([prefix, ...kept.map((r) => r.bytes), dir.subarray(pos)]);

const workbookSource = await fs.readFile(new URL('src/ThisWorkbook.cls', root), 'utf8');
const moduleSource = (await fs.readFile(new URL('src/FormFlowMultiSelect.bas', root), 'utf8'))
  .replace('Attribute VB_Name = "FormFlowMultiSelect"', 'Attribute VB_Name = "Module1"')
  .replace(/^Private hooks As CFormFlowEvents\r?\n/m, '')
  .replace(/^    Set hooks = Nothing\r?\n/m, '')
  .replace(/^    Set hooks = New CFormFlowEvents\r?\n/m, '')
  .replace(/^    Set hooks.App = Application\r?\n/m, '')
  .replace(
    'If cell Is Nothing Then Exit Function',
    'If cell Is Nothing Then Exit Function\n    If Not (cell.Worksheet.Parent Is ThisWorkbook) Then Exit Function',
  );
const sources = { ThisWorkbook: workbookSource, Module1: moduleSource };
for (const name of ['Sheet1', 'Sheet2', 'Sheet3', 'Sheet4']) {
  sources[name] =
    `Attribute VB_Name = "${name}"\nAttribute VB_Base = "0{00020820-0000-0000-C000-000000000046}"\nAttribute VB_GlobalNameSpace = False\nAttribute VB_Creatable = False\nAttribute VB_PredeclaredId = True\nAttribute VB_Exposed = True\nOption Explicit\n`;
}
const result = CFB.utils.cfb_new();
for (const [name, text] of Object.entries(sources)) {
  const source = Buffer.from(text.replace(/\r?\n/g, '\r\n'), 'latin1');
  const compressed = compress(source);
  assert.deepEqual(decompress(compressed), source);
  CFB.utils.cfb_add(result, `VBA/${name}`, compressed);
}
CFB.utils.cfb_add(result, 'VBA/dir', compress(newDir));
// MS-OVBA 2.2.3: version 0xffff instructs Office to compile the source, not use caches.
CFB.utils.cfb_add(result, 'VBA/_VBA_PROJECT', Buffer.from('cc61ffff000300', 'hex'));
let project = CFB.find(base, 'PROJECT').content.toString('latin1');
project = project
  .split('\r\n')
  .filter((line) => !/^(Document=ThisWorkbook1\/|ThisWorkbook1=)/.test(line))
  .join('\r\n');
project = project.replace(
  'Module=Module1',
  'Document=Sheet3/&H00000000\r\nDocument=Sheet4/&H00000000\r\nModule=Module1',
);
CFB.utils.cfb_add(result, 'PROJECT', Buffer.from(project, 'latin1'));
CFB.utils.cfb_add(
  result,
  'PROJECTwm',
  Buffer.concat([
    ...Object.keys(sources).flatMap((name) => [
      Buffer.from(`${name}\0`, 'latin1'),
      Buffer.from(`${name}\0`, 'utf16le'),
    ]),
    Buffer.from([0, 0]),
  ]),
);
const out = new URL('../packages/excel-engine/assets/vbaProject.bin', root);
await fs.mkdir(new URL('../packages/excel-engine/assets/', root), { recursive: true });
await fs.writeFile(out, CFB.write(result, { type: 'buffer' }));
console.log(`Embedded multi-select VBA built: ${out.pathname}`);
