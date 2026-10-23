/**
 * Does the on-chain codeHash actually match the source we can read?
 * The chain's headline promise is "verifiable by default" — so verify it.
 *
 *   node --experimental-strip-types scripts/check-verify.ts
 */
import { blake3 } from '@noble/hashes/blake3.js';
import { AURAS, getContractSource } from '../src/lib/rpc.ts';

const source = await getContractSource(AURAS);
const meta = await fetch(`https://testnet.asentum.com/asentum/account/${AURAS}`).then((r) => r.json());
const target = String(meta.codeHash).replace(/^0x/, '').toLowerCase();

const encoder = new TextEncoder();
const variants: Record<string, Uint8Array> = {
  raw: encoder.encode(source),
  trimmed: encoder.encode(source.trim()),
  trimmedNl: encoder.encode(`${source.trim()}\n`),
  withoutTrailingNl: encoder.encode(source.replace(/\n$/, '')),
};

console.log(`codeHash on chain: ${target}`);
console.log(`source length: ${source.length} chars\n`);

for (const [name, bytes] of Object.entries(variants)) {
  const hash = Buffer.from(blake3(bytes)).toString('hex');
  console.log(`${name.padEnd(20)} ${hash} ${hash === target ? 'MATCH' : ''}`);
}
