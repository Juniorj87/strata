import { resolvePerpsModules } from './perps';
import { getBalance, viewCall } from './rpc';

/**
 * Closing a bot is one owner flow, not separate errands: stop the
 * schedule, close any open AsePad Perps position & pull vault collateral (for
 * perp bots), return the ASE balance, then reclaim unsold tokens. The
 * contracts expose these as separate methods, so this helper sends them in
 * order and reports each wallet signature through `onProgress`.
 */

type ChainClient = {
  call(contract: string, method: string, args?: string[], value?: string | bigint): Promise<string>;
  waitReceipt(hash: string, timeoutMs?: number): Promise<{ success: boolean }>;
};

export type BotStepMethod = 'stop' | 'closePosition' | 'withdraw' | 'withdrawTokens';

export interface BotCloseResult {
  stopped: boolean;
  aseWithdrawn: bigint;
  tokenReclaimed: bigint;
  steps: { method: BotStepMethod; hash: string }[];
}

export interface BotCloseOptions {
  client: ChainClient;
  /** Contract address used for calls (ase1 or 0x). */
  contract: string;
  /** The same contract, in 0x form, for balance reads. */
  balanceAddress: string;
  /** Owner address that receives the funds. */
  recipient: string;
  token: string | null;
  /** momentum-signal and perp-* bots have no withdrawTokens method. */
  supportsTokenWithdraw: boolean;
  /** Perps contract bots expose closePosition() to unwind open leverage and pull Vault collateral. */
  supportsPerpClose?: boolean;
  perpMarketId?: string | null;
  needsStop: boolean;
  onProgress?: (message: string) => void;
  onStopped?: () => void;
  onStep?: (method: BotStepMethod, hash: string) => void;
}

export async function closeBot(options: BotCloseOptions): Promise<BotCloseResult> {
  const {
    client,
    contract,
    balanceAddress,
    recipient,
    token,
    supportsTokenWithdraw,
    supportsPerpClose,
    perpMarketId,
    needsStop,
    onProgress,
    onStopped,
    onStep,
  } = options;

  const steps: BotCloseResult['steps'] = [];
  let promptNumber = 0;

  /**
   * The public gateway sometimes answers with an HTML error page (502/504)
   * instead of JSON. The wallet then reports "Unexpected token '<'…", even
   * when the transaction was in fact broadcast. Treat that as "unknown", then
   * read the chain before asking the user to sign again.
   */
  const transientFailure = (message: string) =>
    /unexpected token|not valid json|<html|bad gateway|gateway time-?out|\b50[24]\b|timed out|receipt timeout|failed to fetch|network ?error|load failed|429|too many requests|rate[- ]?limit/i.test(message);

  const waitFor = async (isDone: () => Promise<boolean>, timeoutMs = 9_000): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await isDone().catch(() => false)) return true;
      await new Promise((resolve) => setTimeout(resolve, 1_500));
    }
    return isDone().catch(() => false);
  };

  const stoppedOnChain = async (): Promise<boolean> => {
    const raw = await viewCall<unknown>(contract, 'getStatus');
    try {
      const status = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return String((status as Record<string, unknown> | null)?.stopped) === 'true';
    } catch {
      return false;
    }
  };

  const labelFor = (method: BotStepMethod) => {
    switch (method) {
      case 'stop': return 'stop the schedule';
      case 'closePosition': return 'close the open perp position and reclaim vault margin';
      case 'withdraw': return 'return the ASE balance';
      case 'withdrawTokens': return 'return the unsold tokens';
    }
  };

  const send = async (
    method: BotStepMethod,
    args: string[] = [],
    isDone?: () => Promise<boolean>,
  ) => {
    const label = labelFor(method);
    promptNumber += 1;
    onProgress?.(`Wallet approval ${promptNumber}: ${label}. Confirm it in your wallet…`);
    try {
      const hash = await client.call(contract, method, args);
      onProgress?.(`${label[0].toUpperCase()}${label.slice(1)} sent — waiting for the receipt…`);
      const receipt = await client.waitReceipt(hash, 120_000);
      if (!receipt.success) {
        throw new Error(`The ${label} transaction reverted on chain. Open it in the explorer for details.`);
      }
      steps.push({ method, hash });
      onStep?.(method, hash);
      return hash;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!isDone || !transientFailure(message)) throw err;
      onProgress?.('The node returned a temporary error. Checking whether that transaction landed…');
      if (!(await waitFor(isDone))) {
        throw new Error(
          'The Asentum node returned a temporary error page instead of a transaction result. Nothing was changed — ' +
          'wait a few seconds and press the button again.',
        );
      }
      onProgress?.('The transaction landed — continuing.');
      return '';
    }
  };

  let stopped = false;
  if (needsStop) {
    await send('stop', [], stoppedOnChain);
    stopped = true;
    onStopped?.();
  }

  // If this is a Perps bot and stop() could not automatically unwind the vault
  // position/margin (e.g. due to temporary oracle issue or previous manual stop),
  // invoke closePosition() before withdrawing ASE from the contract.
  if (supportsPerpClose && perpMarketId) {
    const mods = await resolvePerpsModules().catch(() => null);
    if (mods) {
      const checkVaultRemaining = async (): Promise<boolean> => {
        const [posRaw, freeRaw] = await Promise.all([
          viewCall<unknown>(mods.vault, 'position', [balanceAddress, perpMarketId]).catch(() => null),
          viewCall<string>(mods.vault, 'freeCollateral', [balanceAddress, perpMarketId]).catch(() => '0'),
        ]);
        const posObj = typeof posRaw === 'string' ? JSON.parse(posRaw) : posRaw;
        const size = BigInt(String((posObj as Record<string, unknown> | null)?.sizeWei ?? '0'));
        const free = BigInt(String(freeRaw).replace(/"/g, '') || '0');
        return size === 0n && free === 0n;
      };
      const cleared = await checkVaultRemaining().catch(() => true);
      if (!cleared) {
        await send('closePosition', [], checkVaultRemaining);
      }
    }
  }

  // Read after stopping (and vault reclaim): the receipts refund unused cron
  // escrow and vault collateral into the contract, so this is the closing ASE balance.
  const aseWithdrawn = BigInt((await getBalance(balanceAddress).catch(() => ({ balance: '0', nonce: '0' }))).balance || '0');
  if (aseWithdrawn > 0n) {
    await send('withdraw', [recipient, aseWithdrawn.toString()], async () =>
      BigInt((await getBalance(balanceAddress)).balance || '0') < aseWithdrawn);
  }

  let tokenReclaimed = 0n;
  if (token && supportsTokenWithdraw) {
    const raw = await viewCall<unknown>(token, 'balanceOf', [balanceAddress]).catch(() => '0');
    tokenReclaimed = BigInt(String(raw).replace(/"/g, '') || '0');
    if (tokenReclaimed > 0n) {
      await send('withdrawTokens', [recipient], async () => {
        const left = await viewCall<unknown>(token, 'balanceOf', [balanceAddress]);
        return BigInt(String(left).replace(/"/g, '') || '0') < tokenReclaimed;
      });
    }
  }

  return { stopped, aseWithdrawn, tokenReclaimed, steps };
}
