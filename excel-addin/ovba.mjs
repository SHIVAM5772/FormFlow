// MS-OVBA 2.4.1: interoperable VBA source compression, without compiled caches.
export function decompress(data) {
  if (data[0] !== 1) throw new Error('Invalid VBA compression signature');
  const out = [];
  let pos = 1;
  while (pos < data.length) {
    const header = data.readUInt16LE(pos);
    const end = Math.min(data.length, pos + (header & 0xfff) + 3);
    pos += 2;
    const start = out.length;
    if (!(header & 0x8000)) {
      while (pos < end) out.push(data[pos++]);
      continue;
    }
    while (pos < end) {
      const flags = data[pos++];
      for (let bit = 0; bit < 8 && pos < end; bit++) {
        if (!(flags & (1 << bit))) out.push(data[pos++]);
        else {
          const token = data.readUInt16LE(pos);
          pos += 2;
          const bits = Math.max(4, Math.ceil(Math.log2(out.length - start)));
          const length = (token & (0xffff >>> bits)) + 3;
          const offset = (token >>> (16 - bits)) + 1;
          for (let i = 0; i < length; i++) out.push(out[out.length - offset]);
        }
      }
    }
  }
  return Buffer.from(out);
}

export function compress(data) {
  const chunks = [Buffer.from([1])];
  // Literal-only compressed chunks avoid padding the last source chunk with nulls.
  for (let offset = 0; offset < data.length; offset += 3600) {
    const block = data.subarray(offset, offset + 3600);
    const literals = [];
    for (let i = 0; i < block.length; i += 8)
      literals.push(Buffer.from([0]), block.subarray(i, i + 8));
    const payload = Buffer.concat(literals);
    const header = Buffer.alloc(2);
    header.writeUInt16LE(0xb000 | (payload.length - 1));
    chunks.push(header, payload);
  }
  return Buffer.concat(chunks);
}
