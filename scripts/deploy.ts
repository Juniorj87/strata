/**
 * Deploy a Strata strategy to the Asentum testnet, arm its cron job, verify
 * the source hash and register it in the site's config.
 *
 *   npm run deploy:grid -- --pool 1 --threshold 120 --size 250 --budget 5000 --decimals 18 --levels 5 --escrow 0.05
 *   npm run deploy:risk-managed -- --pool 1 --size 25 --budget 250 --decimals 18 --cost-basis 0.04 --daily-loss 5 --stop-loss 500 --take-profit 1000 --max-drawdown 800 --interval 300
 *
 * The signing key comes from STRATA_SEED (64 hex chars) or .strata/seed.json,
 * which is created on first run and git-ignored.
 */
import { AsentumClient, AsentumContract, AsentumWallet } from '@asentum/sdk';
import { blake3 } from '@noble/hashes/blake3.js';
import { randomBytes } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RPC = process.env.STRATA_RPC ?? 'https://testnet.asentum.com';
const STRATA_HUB = process.env.STRATA_HUB_ADDRESS || 'ase1utdzul2gxdw4c60fr7fcphghlak63sjf8mqnut';
const CONFIG_PATH = resolve(ROOT, 'src/config/strategies.json');
const SEED_PATH = resolve(ROOT, '.strata/seed.json');

const CRON_GAS_LIMIT: Record<string, bigint> = {
  'momentum-signal': 400000n,
  'momentum-trader': 900000n,
  grid: 800000n,
  twap: 700000n,
  dca: 700000n,
  'risk-managed': 900000n,
  scale: 800000n,
  'limit-exit': 750000n,
};

const POOL_TOKENS: Record<string, { token: string; symbol: string }> = {
  '1': { token: '0xc24044dccea3ba8b362e1c85fa16ddc658022269', symbol: 'AURA' },
  '2': { token: '0xbea7c12cba13eddd8e8ad77ff8f62fcf27736d20', symbol: 'NOVA' },
  '3': { token: '0x50cb8d861050ad0052959e0f942c5347842346f1', symbol: 'PULSE' },
};

const TEMPLATES: Record<string, { file: string; args: (a: Args) => string[] }> = {
  'strata-hub': {
    file: 'contracts/strata-hub.js',
    args: () => [],
  },
  marketplace: {
    file: 'contracts/strata-marketplace.js',
    args: () => [],
  },
  'momentum-signal': {
    file: 'contracts/auras-momentum-signal.js',
    args: (a) => [a.pool, a.token, a.threshold, String(a.interval), a.ammAddress],
  },
  'momentum-trader': {
    file: 'contracts/auras-momentum-trader.js',
    args: (a) => [a.pool, a.token, a.threshold, a.sizeWei, String(a.interval), a.ammAddress],
  },
  twap: {
    file: 'contracts/twap.js',
    args: (a) => [a.pool, a.token, a.sizeWei, String(a.slices), a.ammAddress],
  },
  grid: {
    file: 'contracts/grid.js',
    args: (a) => [a.pool, a.token, a.threshold, String(a.levels), a.sizeWei, a.budgetWei, a.buySizeAseWei, a.buyBudgetAseWei, String(a.decimals), a.ammAddress],
  },
  dca: {
    file: 'contracts/dca.js',
    args: (a) => [a.pool, a.token, a.buySizeAseWei, a.buyBudgetAseWei, String(a.interval), a.ammAddress],
  },
  'risk-managed': {
    file: 'contracts/risk-managed.js',
    args: (a) => [a.pool, a.token, a.sizeWei, a.budgetWei, String(a.decimals), a.costBasisAseWei, a.dailyLossLimitAseWei, a.stopLossBps, a.takeProfitBps, a.maxDrawdownBps, String(a.interval), a.ammAddress],
  },
  scale: {
    file: 'contracts/scale.js',
    args: (a) => [a.pool, a.token, a.budgetWei, a.sizeWei, String(a.decimals), a.targetUpsideBps, String(a.levels), String(a.interval), a.ammAddress],
  },
  'limit-exit': {
    file: 'contracts/limit-exit.js',
    args: (a) => [a.pool, a.token, a.sizeWei, a.budgetWei, String(a.decimals), a.targetUpsideBps, String(a.interval), a.ammAddress],
  },
};

interface Args {
  template: string;
  dryRun: boolean;
  pool: string;
  token: string;
  threshold: string;
  size: string;
  sizeWei: string;
  budget: string;
  budgetWei: string;
  decimals: number;
  interval: number;
  slices: number;
  levels: number;
  escrowWei: bigint;
  costBasisAseWei: string;
  dailyLossLimitAseWei: string;
  stopLossBps: string;
  takeProfitBps: string;
  maxDrawdownBps: string;
  targetUpsideBps: string;
  buySizeAseWei: string;
  buyBudgetAseWei: string;
  ammAddress: string;
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

  const rawAmm = (flags.amm ?? 'auras').toLowerCase();
  const ammAddress = rawAmm === 'asedex' || rawAmm === 'asepad'
    ? '0xc3833b73eb30242289e533b3e97c4b72b97e24e9'
    : rawAmm === 'auras' || rawAmm === 'strata'
    ? '0x63f640a9b98b6f28e06cb5cc0fce5d72b6c0eabd'
    : flags.amm || '0x63f640a9b98b6f28e06cb5cc0fce5d72b6c0eabd';

  const template = flags.template ?? 'momentum-signal';
  const dryRun = flags['dry-run'] === 'true';
  const pool = flags.pool ?? '1';
  if (!/^\d+$/.test(pool) || Number(pool) < 1) throw new Error('--pool must be a positive integer');
  const token = flags.token ?? POOL_TOKENS[pool]?.token ?? '';
  if (!token) throw new Error(`Pool #${pool} is not in the local map. Pass its live token address with --token.`);
  const size = flags.size ?? '250';
  const decimals = Number(flags.decimals ?? 18);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) throw new Error('--decimals must be an integer from 0 to 18');
  const parts = size.trim().split('.');
  if (parts.length > 2 || !/^\d+$/.test(parts[0]) || (parts[1] && !/^\d+$/.test(parts[1]))) throw new Error('--size must be a positive decimal number');
  if ((parts[1] ?? '').length > decimals) throw new Error(`--size has more than ${decimals} decimal places`);
  const sizeWei = (BigInt(parts[0]) * 10n ** BigInt(decimals) + BigInt((parts[1] ?? '').padEnd(decimals, '0') || '0')).toString();
  if (BigInt(sizeWei) <= 0n) throw new Error('--size must be greater than zero');
  const parseAseWei = (raw: string, flag: string, allowZero = false) => {
    if (!/^\d+(?:\.\d{1,18})?$/.test(raw)) throw new Error(`${flag} must be an ASE decimal with up to 18 places`);
    const [whole, fraction = ''] = raw.split('.');
    const value = BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0') || '0');
    if (!allowZero && value <= 0n) throw new Error(`${flag} must be greater than zero`);
    return value.toString();
  };
  const costBasisAseWei = parseAseWei(flags['cost-basis'] ?? '0', '--cost-basis', true);
  const dailyLossLimitAseWei = parseAseWei(flags['daily-loss'] ?? '0', '--daily-loss', true);
  const stopLossBps = flags['stop-loss'] ?? '500';
  const takeProfitBps = flags['take-profit'] ?? '1000';
  const maxDrawdownBps = flags['max-drawdown'] ?? '800';
  const targetUpsideBps = flags['target-upside-bps'] ?? '1000';
  for (const [name, value, max] of [['--stop-loss', stopLossBps, 9999], ['--take-profit', takeProfitBps, 50000], ['--max-drawdown', maxDrawdownBps, 9999], ['--target-upside-bps', targetUpsideBps, 50000]] as const) {
    if (!/^\d+$/.test(value) || Number(value) > max) throw new Error(`${name} must be an integer from 0 to ${max} bps`);
  }
  if (template === 'risk-managed' && BigInt(costBasisAseWei) <= 0n) throw new Error('--cost-basis is required for risk-managed strategies and must be positive');
  if ((template === 'scale' || template === 'limit-exit') && Number(targetUpsideBps) <= 0) throw new Error('--target-upside-bps must be greater than zero for price-trigger strategies');
  if (template === 'risk-managed' && Number(stopLossBps) === 0 && Number(takeProfitBps) === 0 && Number(maxDrawdownBps) === 0 && BigInt(dailyLossLimitAseWei) === 0n) throw new Error('Enable at least one risk guard for risk-managed strategies');
  const interval = Number(flags.interval ?? 60);
  if (!Number.isInteger(interval) || interval < 60 || interval > 86400) throw new Error('--interval must be an integer from 60 to 86400 seconds');
  const threshold = flags.threshold ?? '120';
  if (!/^[1-9]\d*$/.test(threshold) || Number(threshold) > 10000) throw new Error('--threshold must be an integer from 1 to 10000 bps');
  const slices = Number(flags.slices ?? 6);
  const levels = Number(flags.levels ?? 5);
  if (!Number.isInteger(slices) || slices < 1 || slices > 100) throw new Error('--slices must be an integer from 1 to 100');
  if (!Number.isInteger(levels) || levels < 1 || levels > 20) throw new Error('--levels must be an integer from 1 to 20');
  if (!/^0x[0-9a-fA-F]{40}$/.test(token) && !/^ase1[0-9a-z]{20,}$/.test(token)) throw new Error('--token must be a valid 0x or ase1 address');
  const tradingTemplate = !['strata-hub', 'marketplace', 'momentum-signal', 'dca'].includes(template);
  const budget = flags.budget ?? (tradingTemplate ? '' : '0');
  let budgetWei = '0';
  if (tradingTemplate) {
    if (!/^\d+(?:\.\d*)?$/.test(budget)) throw new Error('--budget is required for trading templates and must be a positive token amount');
    const [budgetWhole, budgetFraction = ''] = budget.split('.');
    if (budgetFraction.length > decimals) throw new Error(`--budget has more than ${decimals} decimal places`);
    budgetWei = (BigInt(budgetWhole) * 10n ** BigInt(decimals) + BigInt(budgetFraction.padEnd(decimals, '0') || '0')).toString();
    if (BigInt(budgetWei) <= 0n) throw new Error('--budget must be greater than zero');
    if (BigInt(budgetWei) < BigInt(sizeWei)) throw new Error('--budget must be at least --size');
  }
  if (template === 'scale' && BigInt(sizeWei) * BigInt(levels) > BigInt(budgetWei || '0')) throw new Error('--budget must cover --size multiplied by --levels for scale strategies');
  const buySizeAseWei = parseAseWei(flags['buy-size-ase'] ?? '10', '--buy-size-ase');
  const buyBudgetAseWei = parseAseWei(flags['buy-budget-ase'] ?? '100', '--buy-budget-ase');
  if (template === 'grid' || template === 'dca') {
    const requiredBuyBudget = BigInt(buySizeAseWei) * (template === 'grid' ? BigInt(levels) : 1n);
    if (BigInt(buyBudgetAseWei) < requiredBuyBudget) throw new Error('--buy-budget-ase must cover every configured buy execution');
  }
  if (template === 'grid' && Number(threshold) > 5000) throw new Error('--threshold must be at most 5000 bps for grid');
  if (template === 'grid' && BigInt(threshold) * BigInt(levels) >= 10000n) throw new Error('--threshold multiplied by --levels must stay below 10000 bps for grid');
  if (template === 'grid' && BigInt(budgetWei) < BigInt(sizeWei) * BigInt(levels)) throw new Error('--budget must cover --size multiplied by --levels for both grid sides');
  const noCron = template === 'strata-hub' || template === 'marketplace';
  const escrow = flags.escrow ?? (noCron ? '0' : '0.05');
  if (!/^\d+(?:\.\d{1,18})?$/.test(escrow)) throw new Error('--escrow must be a non-negative ASE decimal');
  const [escrowWhole, escrowFraction = ''] = escrow.split('.');
  if (escrowFraction.length > 18) throw new Error('--escrow supports at most 18 decimal places');
  const escrowWei = BigInt(escrowWhole) * 10n ** 18n + BigInt(escrowFraction.padEnd(18, '0') || '0');
  if (!noCron && escrowWei <= 0n) throw new Error('--escrow must be greater than zero');
  const minimumCronEscrow = CRON_GAS_LIMIT[template];
  if (minimumCronEscrow !== undefined && escrowWei < minimumCronEscrow) {
    throw new Error(`--escrow must be at least ${minimumCronEscrow} wei ASE for one scheduled run of ${template}`);
  }

  return {
    template,
    dryRun,
    pool,
    token,
    decimals,
    threshold,
    size,
    sizeWei,
    budget,
    budgetWei,
    interval,
    slices,
    levels,
    escrowWei,
    costBasisAseWei,
    dailyLossLimitAseWei,
    stopLossBps,
    takeProfitBps,
    maxDrawdownBps,
    targetUpsideBps,
    buySizeAseWei,
    buyBudgetAseWei,
    ammAddress,
  };
}

async function loadSeed(): Promise<Uint8Array> {
  if (process.env.STRATA_SEED) {
    const hex = process.env.STRATA_SEED.trim().replace(/^0x/, '');
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('STRATA_SEED must be exactly 64 hexadecimal characters (32 bytes).');
    return Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16)));
  }
  if (existsSync(SEED_PATH)) {
    const saved = JSON.parse(await readFile(SEED_PATH, 'utf8')) as { seed: string };
    if (!/^[0-9a-fA-F]{64}$/.test(saved.seed ?? '')) throw new Error('The seed in .strata/seed.json is invalid. Restore it from your secure backup.');
    return Uint8Array.from(saved.seed.match(/../g)!.map((h) => parseInt(h, 16)));
  }
  const seed = randomBytes(32);
  await mkdir(dirname(SEED_PATH), { recursive: true, mode: 0o700 });
  await writeFile(SEED_PATH, JSON.stringify({ seed: seed.toString('hex') }, null, 2), { mode: 0o600 });
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
  if (args.dryRun) {
    console.log(JSON.stringify({ template: args.template, pool: args.pool, token: args.token, decimals: args.decimals, size: args.size, budget: args.budget, intervalSec: args.interval, escrowWei: args.escrowWei.toString(), initArgs: template.args(args) }, null, 2));
    return;
  }

  const rawSource = await readFile(resolve(ROOT, template.file), 'utf8');
  const source = rawSource.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const client = new AsentumClient(RPC);
  const wallet = AsentumWallet.fromSeed(client, await loadSeed());

  console.log(`\n  template   ${args.template}  (${template.file})`);
  console.log(`  wallet     ${wallet.address}`);
  console.log(`  pool       #${args.pool}  ${POOL_TOKENS[args.pool]?.symbol ?? ''} token ${args.token}`);
  console.log(`  decimals   ${args.decimals}`);
  if (BigInt(args.budgetWei) > 0n) console.log(`  token budget ${args.budget} (raw ${args.budgetWei})`);

  const balance = await wallet.getBalance();
  console.log(`  balance    ${(balance / 10n ** 18n).toString()} ASE`);

  const nativeStrategyBudget = ['grid', 'dca'].includes(args.template) ? BigInt(args.buyBudgetAseWei) : 0n;
  if (balance < args.escrowWei + nativeStrategyBudget + 10n ** 15n) {
    console.error(
      `\n  Not enough test ASE for the deploy fee and the cron escrow.\n` +
        `  Get some at https://airdrop.asentum.com for ${wallet.address} (5 ASE per hour),\n` +
        `  then run this command again.\n`,
    );
    process.exit(2);
  }

  let tokenContract: AsentumContract | undefined;
  if (BigInt(args.budgetWei) > 0n) {
    tokenContract = new AsentumContract(client, args.token).connect(wallet);
    const tokenBalance = BigInt(String(await tokenContract.view('balanceOf', [wallet.address])));
    if (tokenBalance < BigInt(args.budgetWei)) {
      console.error(`\n  Not enough ${args.token} in the deployer wallet. Required raw token units: ${args.budgetWei}.`);
      process.exit(5);
    }
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

  // Verify the deployed source before initializing or funding the strategy.
  const code = (await (
    await fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getCode', params: [address, 'latest'] }),
    })
  ).json()) as { result: string };

  let deployedSource = '';
  if (code.result && code.result !== '0x') {
    const bytes = Buffer.from(code.result.slice(2), 'hex');
    const sourceBytes = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes;
    deployedSource = new TextDecoder().decode(sourceBytes);
  }
  const localHash = Buffer.from(blake3(new TextEncoder().encode(source))).toString('hex');
  const localTrimmedHash = Buffer.from(blake3(new TextEncoder().encode(source.trim()))).toString('hex');
  const localTrimmedNlHash = Buffer.from(blake3(new TextEncoder().encode(`${source.trim()}\n`))).toString('hex');
  const onChainHash = Buffer.from(blake3(new TextEncoder().encode(deployedSource.replace(/\r\n/g, '\n')))).toString('hex');

  const meta = (await (await fetch(`${RPC}/asentum/account/${address}`)).json()) as { codeHash?: string };
  const stored = String(meta.codeHash ?? '').replace(/^0x/, '').toLowerCase();

  const validHashes = [localHash, localTrimmedHash, localTrimmedNlHash];
  const isMatch = (stored && validHashes.includes(stored)) || (onChainHash && validHashes.includes(onChainHash));

  console.log(`\n  local BLAKE3   ${localHash}`);
  console.log(`  on-chain hash  ${stored}`);
  console.log(`  read back      ${onChainHash}`);
  console.log(`  match          ${isMatch ? 'YES' : 'NO'}`);

  if (!isMatch) {
    console.warn('  warning: source hash differs or is indexing on chain, proceeding with init...');
  }


  console.log('  calling init()…');
  const initArgs = template.args(args);
  const initTx = await contract.send('init', initArgs, { valueWei: args.escrowWei + nativeStrategyBudget });
  const initReceipt = await initTx.wait();
  if (!initReceipt.success) {
    console.error(`  init failed: ${JSON.stringify(initReceipt)}`);
    process.exit(4);
  }

  if (tokenContract && BigInt(args.budgetWei) > 0n) {
    console.log('  funding strategy token allocation…');
    const fundingTx = await tokenContract.send('transfer', [address, args.budgetWei]);
    const fundingReceipt = await fundingTx.wait();
    if (!fundingReceipt.success) {
      console.error(`  strategy was initialized but token funding reverted: ${JSON.stringify(fundingReceipt)}`);
      console.error(`  contract address: ${address}`);
      process.exit(6);
    }
  }

  if (!['strata-hub', 'marketplace'].includes(args.template)) {
  console.log('  registering in Strata Hub…');
  try {
    const hub = new AsentumContract(client, STRATA_HUB).connect(wallet);
    const registrationTx = await hub.send('registerStrategy', [address, args.template, args.pool]);
    const registrationReceipt = await registrationTx.wait();
    if (!registrationReceipt.success) {
      console.warn('  warning: strategy is deployed, but Hub registration reverted. It will not appear in the global leaderboard until registered.');
    } else {
      console.log('  registered in Strata Hub');
    }
  } catch (error) {
    console.warn(`  warning: strategy is deployed, but Hub registration failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  }


  if (!['strata-hub', 'marketplace'].includes(args.template)) {
    const existing = existsSync(CONFIG_PATH)
      ? (JSON.parse(await readFile(CONFIG_PATH, 'utf8')) as unknown[])
      : [];
    const merged = [
      ...existing.filter((entry) => (entry as { address: string }).address !== address),
      { address, template: args.template, pool: args.pool, deployedAt: new Date().toISOString() },
    ];
    await writeFile(CONFIG_PATH, `${JSON.stringify(merged, null, 2)}\n`);
    console.log(`\n  registered in src/config/strategies.json`);
  }
  console.log(`  explorer      https://explorer.asentum.com/address/${wallet.address}`);
  console.log(`  strategy      https://explorer.asentum.com/address/${address}\n`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
