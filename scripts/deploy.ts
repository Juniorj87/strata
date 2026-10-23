/**
 * Deploy a Strata strategy to the Asentum testnet, arm its cron job, verify
 * the source hash and register it in the site's config.
 *
 *   npm run deploy:momentum-signal -- --pool 1 --threshold 120 --interval 60
 *
 * The signing key comes from STRATA_SEED (64 hex chars) or .strata/seed.json,
 * which is created on first run and git-ignored.
 */
import { AsentumClient, AsentumWallet } from '@asentum/sdk';
import { blake3 } from '@noble/hashes/blake3.js';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RPC = process.env.STRATA_RPC ?? 'https://testnet.asentum.com';
const CONFIG_PATH = resolve(ROOT, 'src/config/strategies.json');
const SEED_PATH = resolve(ROOT, '.strata/seed.json');

const POOL_TOKENS: Record<string, { token: string; symbol: string }> = {
  '1': { token: '0xc24044dccea3ba8b362e1c85fa16ddc658022269', symbol: 'AURA' },
  '2': { token: '0xbea7c12cba13eddd8e8ad77ff8f62fcf27736d20', symbol: 'NOVA' },
  '3': { token: '0x50cb8d861050ad0052959e0f942c5347842346f1', symbol: 'PULSE' },
};

const TEMPLATES: Record<string, { file: string; args: (a: Args) => string[] }> = {
  'momentum-signal': {
    file: 'contracts/auras-momentum-signal.js',
    args: (a) => [a.pool, a.token, a.threshold, String(a.interval)],
  },
  'momentum-trader': {
    file: 'contracts/auras-momentum-trader.js',
    args: (a) => [a.pool, a.token, a.threshold, a.sizeWei, String(a.interval)],
  },
  twap: {
    file: 'contracts/twap.js',
    args: (a) => [a.pool, a.token, a.sizeWei, String(a.slices)],
  },
  grid: {
    file: 'contracts/grid.js',
    args: (a) => [a.pool, a.token, a.threshold, String(a.levels), a.sizeWei],
  },
  dca: {
    file: 'contracts/dca.js',
    args: (a) => [a.pool, a.token, a.sizeWei],
  },
};

interface Args {
  template: string;
  pool: string;
  token: string;
  threshold: string;
  size: string;
  sizeWei: string;
  interval: number;
  slices: number;
  levels: number;
  escrowWei: bigint;
}

function parseArgs(argv: string[]): Args {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      flags[key.slice(2)] = 'true';
    } else {
      flags[key.slice(2)] = next;
      i += 1;
    }
  }

  const template = flags.template ?? 'momentum-signal';
  const pool = flags.pool ?? '1';
  const token = flags.token ?? POOL_TOKENS[pool]?.token ?? POOL_TOKENS['1'].token;
  const size = flags.size ?? '250';
  const sizeWei = BigInt(Math.round(Number(size) * 1e18)).toString();
  const interval = Number(flags.interval ?? 60);
  const escrowWei = BigInt(Math.round(Number(flags.escrow ?? 0.05) * 1e18));

  return {
    template,
    pool,
    token,
    threshold: flags.threshold ?? '120',
    size,
    sizeWei,
    interval,
    slices: Number(flags.slices ?? 6),
    levels: Number(flags.levels ?? 5),
    escrowWei,
  };
}

async function loadSeed(): Promise<Uint8Array> {
  if (process.env.STRATA_SEED) {
    const hex = process.env.STRATA_SEED.trim();
    return Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16)));
  }
  if (existsSync(SEED_PATH)) {
    const saved = JSON.parse(await readFile(SEED_PATH, 'utf8')) as { seed: string };
    return Uint8Array.from(saved.seed.match(/../g)!.map((h) => parseInt(h, 16)));
  }
  const seed = randomBytes(32);
  await mkdir(dirname(SEED_PATH), { recursive: true });
  await writeFile(SEED_PATH, JSON.stringify({ seed: seed.toString('hex') }, null, 2));
  console.log('created a new signing seed in .strata/seed.json (git-ignored)');
  return new Uint8Array(seed);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const template = TEMPLATES[args.template];
  if (!template) {
    console.error(`unknown template "${args.template}". known: ${Object.keys(TEMPLATES).join(', ')}`);
    process.exit(1);
  }

  const source = await readFile(resolve(ROOT, template.file), 'utf8');
  const client = new AsentumClient(RPC);
  const wallet = AsentumWallet.fromSeed(client, await loadSeed());

  console.log(`\n  template   ${args.template}  (${template.file})`);
  console.log(`  wallet     ${wallet.address}`);
  console.log(`  pool       #${args.pool}  ${POOL_TOKENS[args.pool]?.symbol ?? ''} token ${args.token}`);

  const balance = await wallet.getBalance();
  console.log(`  balance    ${(balance / 10n ** 18n).toString()} ASE`);

  if (balance < args.escrowWei + 10n ** 15n) {
    console.error(
      `\n  Not enough test ASE for the deploy fee and the cron escrow.\n` +
        `  Get some at https://airdrop.asentum.com for ${wallet.address} (5 ASE per hour),\n` +
        `  then run this command again.\n`,
    );
    process.exit(2);
  }

  console.log('\n  deploying source…');
  const contract = await wallet.deploy(source);
  const receipt = await contract.waitForDeploy();
  if (!receipt.success) {
    console.error(`  deploy failed: ${JSON.stringify(receipt)}`);
    process.exit(3);
  }
  const address = receipt.contractAddress ?? contract.address;
  console.log(`  deployed   ${address}`);

  console.log('  calling init()…');
  const initArgs = template.args(args);
  const initTx = await contract.send('init', initArgs, { valueWei: args.escrowWei });
  const initReceipt = await initTx.wait();
  if (!initReceipt.success) {
    console.error(`  init failed: ${JSON.stringify(initReceipt)}`);
    process.exit(4);
  }

  // Verify what actually landed on chain.
  const code = (await (
    await fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getCode', params: [address, 'latest'] }),
    })
  ).json()) as { result: string };

  let deployedSource = '';
  if (code.result && code.result !== '0x') {
    const bytes = Uint8Array.from(code.result.slice(2).match(/../g)!.map((h) => parseInt(h, 16)));
    deployedSource = new TextDecoder().decode(bytes);
  }
  const localHash = Buffer.from(blake3(new TextEncoder().encode(source))).toString('hex');
  const onChainHash = Buffer.from(blake3(new TextEncoder().encode(deployedSource))).toString('hex');

  const meta = (await (await fetch(`${RPC}/asentum/account/${address}`)).json()) as { codeHash?: string };
  const stored = String(meta.codeHash ?? '').replace(/^0x/, '').toLowerCase();

  console.log(`\n  local BLAKE3   ${localHash}`);
  console.log(`  on-chain hash  ${stored}`);
  console.log(`  read back      ${onChainHash}`);
  console.log(`  match          ${stored === localHash && stored === onChainHash ? 'YES' : 'NO'}`);

  const existing = existsSync(CONFIG_PATH)
    ? (JSON.parse(await readFile(CONFIG_PATH, 'utf8')) as unknown[])
    : [];
  const merged = [
    ...existing.filter((entry) => (entry as { address: string }).address !== address),
    { address, template: args.template, pool: args.pool, deployedAt: new Date().toISOString() },
  ];
  await writeFile(CONFIG_PATH, `${JSON.stringify(merged, null, 2)}\n`);

  console.log(`\n  registered in src/config/strategies.json`);
  console.log(`  explorer      https://explorer.asentum.com/address/${wallet.address}`);
  console.log(`  strategy      https://explorer.asentum.com/address/${address}\n`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
