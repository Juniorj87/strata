import type { AsentumClient } from '@asentum/connect';
import { chainStorageKey } from './network';

/**
 * ARC-20 token deployment on Asentum.
 *
 * Asentum has no protocol-level token factory: a token is a JavaScript
 * contract. This module deploys the ARC-20 interface from the published
 * standard (name/symbol/decimals/totalSupply/balanceOf/allowance, transfer,
 * approve, transferFrom, Transfer and Approval events, standard storage keys)
 * and mints the entire supply to the deployer in `init`.
 *
 * There is deliberately no owner mint, tax, blacklist or pause. The standard
 * has no description field, so the form does not ask for one.
 */

export const ARC20_SOURCE = `// ARC-20: fixed-supply fungible token.
// Strata token factory · Asentum Request for Comment 20
//
// Storage layout follows the ARC-20 standard:
//   meta:name / meta:symbol / meta:decimals / meta:totalSupply
//   balance:<addr> / allowance:<owner>:<spender>

const ZERO = '0x' + '0'.repeat(40);

function bal(addr) {
  return BigInt(storage.get('balance:' + addr) || '0');
}

({
  init(name, symbol, decimals, initialSupply) {
    assert(!storage.get('meta:name'), 'already initialised');
    assert(typeof name === 'string' && name.length > 0 && name.length <= 64, 'name required (max 64 chars)');
    assert(typeof symbol === 'string' && symbol.length > 0 && symbol.length <= 16, 'symbol required (max 16 chars)');
    const dec = BigInt(decimals);
    assert(dec >= 0n && dec <= 38n, 'decimals out of range');
    const supply = BigInt(initialSupply);
    assert(supply > 0n, 'supply must be positive');
    const sender = String(msg.sender).toLowerCase();

    storage.set('meta:name', name);
    storage.set('meta:symbol', symbol);
    storage.set('meta:decimals', dec.toString());
    storage.set('meta:totalSupply', supply.toString());
    storage.set('balance:' + sender, supply.toString());
    emit('Transfer', { from: ZERO, to: sender, value: supply.toString() });
    return true;
  },

  name() { return storage.get('meta:name') || ''; },
  symbol() { return storage.get('meta:symbol') || ''; },
  decimals() { return storage.get('meta:decimals') || '0'; },
  totalSupply() { return storage.get('meta:totalSupply') || '0'; },

  balanceOf(addr) {
    return storage.get('balance:' + String(addr).toLowerCase()) || '0';
  },

  allowance(owner, spender) {
    return storage.get(
      'allowance:' + String(owner).toLowerCase() + ':' + String(spender).toLowerCase(),
    ) || '0';
  },

  transfer(to, amount) {
    const from = String(msg.sender).toLowerCase();
    const recipient = String(to).toLowerCase();
    assert(recipient !== ZERO, 'transfer to zero address');
    const amt = BigInt(amount);
    assert(amt >= 0n, 'amount must be non-negative');
    const fromBal = bal(from);
    assert(fromBal >= amt, 'insufficient balance');
    storage.set('balance:' + from, (fromBal - amt).toString());
    storage.set('balance:' + recipient, (bal(recipient) + amt).toString());
    emit('Transfer', { from, to: recipient, value: amt.toString() });
    return true;
  },

  approve(spender, amount) {
    const owner = String(msg.sender).toLowerCase();
    const sp = String(spender).toLowerCase();
    const amt = BigInt(amount);
    assert(amt >= 0n, 'amount must be non-negative');
    storage.set('allowance:' + owner + ':' + sp, amt.toString());
    emit('Approval', { owner, spender: sp, value: amt.toString() });
    return true;
  },

  transferFrom(from, to, amount) {
    const owner = String(from).toLowerCase();
    const spender = String(msg.sender).toLowerCase();
    const recipient = String(to).toLowerCase();
    assert(recipient !== ZERO, 'transfer to zero address');
    const amt = BigInt(amount);
    assert(amt >= 0n, 'amount must be non-negative');
    const key = 'allowance:' + owner + ':' + spender;
    const allowed = BigInt(storage.get(key) || '0');
    assert(allowed >= amt, 'allowance exceeded');
    const fromBal = bal(owner);
    assert(fromBal >= amt, 'insufficient balance');
    const next = allowed - amt;
    storage.set(key, next.toString());
    emit('Approval', { owner, spender, value: next.toString() });
    storage.set('balance:' + owner, (fromBal - amt).toString());
    storage.set('balance:' + recipient, (bal(recipient) + amt).toString());
    emit('Transfer', { from: owner, to: recipient, value: amt.toString() });
    return true;
  },
});
`;

export interface Arc20Params {
  name: string;
  symbol: string;
  decimals: number;
  /** Raw integer supply, already scaled by 10^decimals. */
  supplyRaw: string;
}

export interface Arc20Deployment {
  address: string;
  deployTxHash: string;
  initTxHash: string;
}

const DRAFT_KEY = chainStorageKey('strata:token_draft_v1');

export interface TokenDraft {
  address: string;
  deployTxHash: string;
  initTxHash?: string;
  params: Arc20Params;
  owner: string;
  createdAt: number;
  status: 'deployed' | 'initialised';
}

export function loadTokenDraft(): TokenDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TokenDraft;
    return parsed && typeof parsed.address === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

export function saveTokenDraft(draft: TokenDraft): void {
  try { window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* storage unavailable */ }
}

export function clearTokenDraft(): void {
  try { window.localStorage.removeItem(DRAFT_KEY); } catch { /* storage unavailable */ }
}

function normalizeParams(params: Arc20Params): Arc20Params {
  const name = params.name.trim();
  const symbol = params.symbol.trim().toUpperCase();
  if (!name) throw new Error('Enter a token name.');
  if (name.length > 64) throw new Error('Token name must be 64 characters or fewer.');
  if (!symbol) throw new Error('Enter a token symbol.');
  if (!/^[A-Z0-9]{1,16}$/.test(symbol)) throw new Error('Symbol must be 1–16 letters or digits.');
  if (!Number.isInteger(params.decimals) || params.decimals < 0 || params.decimals > 18) {
    throw new Error('Decimals must be a whole number between 0 and 18.');
  }
  let supply: bigint;
  try { supply = BigInt(params.supplyRaw); } catch { throw new Error('Supply is not a valid integer.'); }
  if (supply <= 0n) throw new Error('Supply must be greater than zero.');
  return { name, symbol, decimals: params.decimals, supplyRaw: supply.toString() };
}

/** Deploy the contract only. Recoverable on its own if `init` fails. */
export async function deployArc20(
  client: AsentumClient,
  params: Arc20Params,
  onStage?: (stage: string) => void,
): Promise<{ address: string; txHash: string }> {
  normalizeParams(params);
  onStage?.('Confirm the token contract deployment in your wallet');
  const { txHash, contractAddress } = await client.deploy(ARC20_SOURCE);
  if (!/^0x[0-9a-fA-F]{40}$/.test(contractAddress)) {
    throw new Error('The wallet returned no contract address for the deployment.');
  }
  onStage?.('Waiting for the deployment to confirm…');
  const receipt = await client.waitReceipt(txHash, 180_000).catch(() => null);
  if (receipt && !receipt.success) {
    throw new Error('The token contract deployment reverted on chain. No token was created.');
  }
  return { address: contractAddress.toLowerCase(), txHash };
}

/** Initialise a deployed contract and mint the fixed supply to its deployer. */
export async function initArc20(
  client: AsentumClient,
  address: string,
  params: Arc20Params,
  onStage?: (stage: string) => void,
): Promise<string> {
  const clean = normalizeParams(params);
  onStage?.('Confirm the token initialisation in your wallet');
  const hash = await client.call(address, 'init', [
    clean.name,
    clean.symbol,
    clean.decimals,
    clean.supplyRaw,
  ]);
  onStage?.('Waiting for initialisation to confirm…');
  const receipt = await client.waitReceipt(hash, 180_000);
  if (!receipt.success) {
    throw new Error('Initialisation reverted. The contract exists but has no supply; retry initialisation.');
  }
  return hash;
}

export interface Arc20Verification {
  name: string;
  symbol: string;
  decimals: string;
  totalSupply: string;
  deployerBalance: string;
}

/** Read the token back from chain state after creation. */
export async function verifyArc20(
  client: AsentumClient,
  address: string,
  ownerHex: string,
): Promise<Arc20Verification> {
  const [name, symbol, decimals, totalSupply, deployerBalance] = await Promise.all([
    client.view<unknown>(address, 'name', []).then(String),
    client.view<unknown>(address, 'symbol', []).then(String),
    client.view<unknown>(address, 'decimals', []).then(String),
    client.view<unknown>(address, 'totalSupply', []).then(String),
    client.view<unknown>(address, 'balanceOf', [ownerHex]).then(String),
  ]);
  return { name, symbol, decimals, totalSupply, deployerBalance };
}

export function tokenFactoryError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/reject|denied|cancel|declin/i.test(raw)) return 'The wallet rejected the transaction. Nothing was sent.';
  if (/already initialised/i.test(raw)) return 'This contract was already initialised. Do not initialise it twice.';
  if (/non-JSON|busy|502|504|timed out|network|fetch|no response/i.test(raw)) {
    return 'The Asentum node did not answer. Check the explorer before retrying so a token is not deployed twice.';
  }
  return raw;
}
