// Test helper (KC-0206): reads a store-only zip (sky/src/delt/zip.ts) back into name → bytes, via its central directory.
export function laesZip(z: Buffer): Map<string, Buffer> {
  const slut = z.length - 22;
  if (z.readUInt32LE(slut) !== 0x06054b50) throw new Error('ikke en zip');
  const antal = z.readUInt16LE(slut + 10);
  let p = z.readUInt32LE(slut + 16);
  const ud = new Map<string, Buffer>();
  for (let i = 0; i < antal; i++) {
    if (z.readUInt32LE(p) !== 0x02014b50) throw new Error('ødelagt central directory');
    const stoerrelse = z.readUInt32LE(p + 20);
    const navnLaengde = z.readUInt16LE(p + 28);
    const ekstra = z.readUInt16LE(p + 30);
    const kommentar = z.readUInt16LE(p + 32);
    const offset = z.readUInt32LE(p + 42);
    const navn = z.subarray(p + 46, p + 46 + navnLaengde).toString('utf8');
    const lokalNavn = z.readUInt16LE(offset + 26);
    const lokalEkstra = z.readUInt16LE(offset + 28);
    const start = offset + 30 + lokalNavn + lokalEkstra;
    ud.set(navn, z.subarray(start, start + stoerrelse));
    p += 46 + navnLaengde + ekstra + kommentar;
  }
  return ud;
}
