/**
 * Sanity check against the live testnet. Also proves the bech32 encoder:
 * every address the explorer shows as ase1 must round-trip from 0x hex.
 *
 *   node --experimental-strip-types scripts/check-chain.ts
 */
import {
  AURAS,
  POOLS,
  consult,
  getAccountMeta,
  getContractSource,
  getCronJob,
  getHeads,
  getPool,
  getRecentContracts,
  quote,
  toAse1,
  viewCall,
} from '../src/lib/rpc.ts';

const EXPECTED = {
  '0x63f640a9b98b6f28e06cb5cc0fce5d72b6c0eabd': 'ase1v0myp2de3dhj3crvkhxqlnjaw2mvp64a9efkpl',
};

/** Minimal bech32 decoder — used to verify the encoder against a real address. */
function fromAse1(address: string): string {
  const data = address.slice(5).split('').map((c) => 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'.indexOf(c));
  const bytes = convertBitsBack(data.slice(0, data.length - 6), 5, 8, false);
  return `0x${bytes.map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function convertBitsBack(data: number[], from: number, to: number): number[] {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  const maxv = (1 << to) - 1;
  for (const value of data) {
    acc = (acc << from) | value;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >> bits) & maxv);
    }
  }
  return out;
}

const heads = await getHeads();
console.log(`heads        finalized=${heads.finalized} tip=${heads.tip}`);

for (const [hex, ase] of Object.entries(EXPECTED)) {
  const got = toAse1(hex);
  console.log(`bech32       ${hex} -> ${got} ${got === ase ? 'OK' : `MISMATCH (expected ${ase})`}`);
}

for (const pool of POOLS) {
  const onChain = await getPool(pool.id);
  const twap = await consult(pool.id);
  const out = await quote(pool.id, pool.token, '1000000000000000000');
  console.log(
    `pool ${pool.id}     ${pool.symbol}/ASE  reserve=${onChain?.reserve0}  1 token -> ${out}  twap@${twap.lastTs}`,
  );
}

const meta = await getAccountMeta(AURAS);
console.log(`auras meta   codeHash=${meta.codeHash} exists=${meta.exists}`);

const source = await getContractSource(AURAS);
console.log(`auras source ${source.length} bytes, first line: ${source.split('\n')[0]}`);

const tokenSymbol = await viewCall<string>(POOLS[0].token, 'symbol', []);
console.log(`token        ${POOLS[0].token} symbol=${tokenSymbol}`);

const job = await getCronJob('1');
console.log(`cron job 1   ${job ? JSON.stringify(job).slice(0, 160) : 'none'}`);

const contracts = await getRecentContracts(5);
console.log(`recent       ${contracts.length} contracts, first block ${contracts[0]?.deployBlock}`);
for (const c of contracts.slice(0, 3)) console.log(`             ${c.address} by ${c.deployer} @${c.deployBlock}`);

// Which contract does the auras.finance frontend actually talk to?
const frontendAddress = 'ase1cfqyfhxw5wagkd3wrjzl59kacevqygnfngeahr';
console.log(`frontend ase ${frontendAddress} -> ${fromAse1(frontendAddress)}`);
for (const candidate of [
  '0x63f640a9b98b6f28e06cb5cc0fce5d72b6c0eabd',
  '0x8afe866989eadca8a0bf743277455e82b12eacc1',
  '0xa0081bced0018bbe4d08957417cb303737c54bc2',
  '0xc3833b73eb30242289e533b3e97c4b72b97e24e9',
]) {
  console.log(`             ${candidate} -> ${toAse1(candidate)}`);
}
