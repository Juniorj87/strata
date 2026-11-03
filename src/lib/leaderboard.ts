import { ase1ToHex } from '@asentum/connect';
import { getAccountMeta, getHeads, getContractSource, getLogs, getRecentContracts, hashSource, STRATA_HUB, toAse1, viewCall } from './rpc';
import { getUserStrategies } from './userStrategies';

import momentumSignalSource from '../../contracts/auras-momentum-signal.js?raw';
import momentumTraderSource from '../../contracts/auras-momentum-trader.js?raw';
import gridSource from '../../contracts/grid.js?raw';
import twapSource from '../../contracts/twap.js?raw';
import dcaSource from '../../contracts/dca.js?raw';
import riskManagedSource from '../../contracts/risk-managed.js?raw';
import scaleSource from '../../contracts/scale.js?raw';
import limitExitSource from '../../contracts/limit-exit.js?raw';

const TRUSTED_TEMPLATE_SOURCES: Record<string, string> = {
  'momentum-signal': momentumSignalSource,
  'momentum-trader': momentumTraderSource,
  grid: gridSource,
  twap: twapSource,
  dca: dcaSource,
  'risk-managed': riskManagedSource,
  scale: scaleSource,
  'limit-exit': limitExitSource,
};

const expectedHashes = new Map<string, Promise<string>>();

export interface TokenInputVolume {
  token: string;
  symbol: string;
  decimals: number | null;
  amount: string;
}

export interface LeaderboardRow {
  wallet: string;
  deploys: number;
  fills: number;
  escrowWei: string;
  grossAseWei: string;
  sharePct: number;
  tokenInputs: TokenInputVolume[];
  strategies: string[];
}

export interface LeaderboardData {
  rows: LeaderboardRow[];
  fromBlock: number;
  toBlock: number;
  indexedHub: boolean;
  skippedUnverified: number;
}

const normalise = (address: string) => {
  const value = String(address || '').toLowerCase();
  if (value.startsWith('ase1')) return ase1ToHex(value)?.toLowerCase() ?? value;
  return value;
};

async function verifyRegisteredStrategy(
  address: string,
  template: string,
): Promise<boolean> {
  const expectedSource = TRUSTED_TEMPLATE_SOURCES[template];
  if (!expectedSource) return false;

  let expectedHashPromise = expectedHashes.get(template);
  if (!expectedHashPromise) {
    expectedHashPromise = hashSource(expectedSource);
    expectedHashes.set(template, expectedHashPromise);
  }

  try {
    const [source, meta] = await Promise.all([
      getContractSource(address),
      getAccountMeta(address),
    ]);
    if (!source || !meta.codeHash) return false;

    const [expectedHash, deployedHash] = await Promise.all([
      expectedHashPromise,
      hashSource(source),
    ]);
    const storedHash = String(meta.codeHash).replace(/^0x/, '').toLowerCase();
    return deployedHash === expectedHash && storedHash === expectedHash;
  } catch {
    return false;
  }
}

/**
 * Builds a transparent on-chain leaderboard.
 * A Hub registration alone is not trusted: the strategy must also emit a
 * matching StrataDeploy event and its deployed source must hash to the exact
 * template source shipped with this app. This prevents arbitrary contracts
 * from being registered just to spoof leaderboard totals.
 */
export async function loadLeaderboard(): Promise<LeaderboardData> {
  const heads = await getHeads();
  let hubDeployBlock: number | undefined;
  let indexedHub = false;

  let recentContracts: Awaited<ReturnType<typeof getRecentContracts>> = [];
  try {
    recentContracts = await getRecentContracts(500, 0);
    const hubHex = normalise(STRATA_HUB);
    const hub = recentContracts.find((entry) => normalise(entry.address) === hubHex);
    if (hub && Number.isFinite(hub.deployBlock)) {
      hubDeployBlock = Number(hub.deployBlock);
      indexedHub = true;
    }
  } catch {
    // Use a bounded recent window if the explorer indexer is unavailable.
  }

  const fromBlock = hubDeployBlock ?? Math.max(0, heads.finalized - 260_000);
  const hubLogs = await getLogs(STRATA_HUB, fromBlock, heads.finalized).catch(() => []);
  const registrations = hubLogs.filter((log) => {
    const args = log.args ?? {};
    return Boolean(args.strategy && args.user && args.template);
  });

  const deploymentBlocks = new Map<string, number>();
  for (const contract of recentContracts) {
    deploymentBlocks.set(normalise(contract.address), Number(contract.deployBlock));
  }

  const candidates = new Map<string, { owner: string; template: string; poolId: string; registeredAt: number }>();
  let skippedUnverified = 0;
  for (const registration of registrations) {
    const args = registration.args ?? {};
    const owner = String(args.user ?? '');
    const strategy = normalise(String(args.strategy ?? ''));
    const template = String(args.template ?? '');
    const poolId = String(args.poolId ?? '');
    if (!owner || !strategy || !TRUSTED_TEMPLATE_SOURCES[template]) {
      skippedUnverified += 1;
      continue;
    }

    const previous = candidates.get(strategy);
    candidates.set(strategy, {
      owner: previous?.owner ?? owner,
      template,
      poolId,
      registeredAt: Math.min(previous?.registeredAt ?? registration.blockNumber, registration.blockNumber),
    });
  }

  // Also include user-deployed strategies recorded locally
  try {
    const userRecords = getUserStrategies();
    for (const rec of userRecords) {
      const stratHex = normalise(rec.address);
      if (!candidates.has(stratHex) && TRUSTED_TEMPLATE_SOURCES[rec.template]) {
        candidates.set(stratHex, {
          owner: normalise(rec.owner),
          template: rec.template,
          poolId: rec.poolId,
          registeredAt: heads.finalized,
        });
      }
    }
  } catch {
    // non-blocking
  }

  const statsByWallet = new Map<string, {
    deploys: Set<string>;
    fills: number;
    escrow: bigint;
    gross: bigint;
    inputs: Map<string, bigint>;
  }>();
  const ensure = (wallet: string) => {
    const key = normalise(wallet);
    if (!statsByWallet.has(key)) statsByWallet.set(key, { deploys: new Set(), fills: 0, escrow: 0n, gross: 0n, inputs: new Map() });
    return statsByWallet.get(key)!;
  };

  const candidateEntries = [...candidates.entries()];
  for (let offset = 0; offset < candidateEntries.length; offset += 4) {
    const batch = candidateEntries.slice(offset, offset + 4);
    const verifiedBatch = await Promise.all(batch.map(async ([strategy, record]) => {
      // Strategy initialization emits StrataDeploy before the subsequent Hub
      // registration transaction. Prefer the explorer's creation block; the
      // fallback scans up to 10,000 finalized blocks before registration.
      const createdAt = deploymentBlocks.get(strategy);
      const scanFrom = createdAt !== undefined
        ? createdAt
        : Math.max(0, record.registeredAt - 10_000);
      const logs = await getLogs(strategy, scanFrom, heads.finalized).catch(() => []);
      const deployEvent = logs.find((log) => {
        const args = log.args ?? {};
        return args.template === record.template
          && normalise(String(args.owner ?? '')) === normalise(record.owner)
          && args.gasEscrowWei !== undefined;
      });
      if (!deployEvent) return { strategy, record, logs: [], verified: false };

      const verified = await verifyRegisteredStrategy(strategy, record.template);
      return { strategy, record, logs, verified };
    }));

    for (const result of verifiedBatch) {
      if (!result.verified) {
        skippedUnverified += 1;
        continue;
      }

      const stats = ensure(result.record.owner);
      stats.deploys.add(result.strategy);

      const deployEvent = result.logs.find((log) => {
        const args = log.args ?? {};
        return args.template === result.record.template
          && normalise(String(args.owner ?? '')) === normalise(result.record.owner)
          && args.gasEscrowWei !== undefined;
      });
      if (deployEvent) {
        try { stats.escrow += BigInt(String(deployEvent.args?.gasEscrowWei)); } catch { /* ignore malformed event */ }
      }

      for (const log of result.logs) {
        if (deployEvent && log.blockNumber < deployEvent.blockNumber) continue;
        const args = log.args ?? {};
        if (args.amountOut === undefined || args.amountIn === undefined || args.tokenIn === undefined) continue;
        try {
          const amountOut = BigInt(String(args.amountOut));
          const amountIn = BigInt(String(args.amountIn));
          const token = normalise(String(args.tokenIn));
          if (amountOut <= 0n || amountIn <= 0n || !token) continue;
          stats.fills += 1;
          stats.gross += amountOut;
          stats.inputs.set(token, (stats.inputs.get(token) ?? 0n) + amountIn);
        } catch {
          // Ignore malformed event payloads; never fabricate a result.
        }
      }
    }
  }

  const tokenAddresses = [...new Set([...statsByWallet.values()].flatMap((row) => [...row.inputs.keys()]))];
  const tokenMeta = new Map<string, { symbol: string; decimals: number | null }>();
  await Promise.all(tokenAddresses.map(async (token) => {
    const [symbolResult, decimalsResult] = await Promise.allSettled([
      viewCall<string>(token, 'symbol', []),
      viewCall<string | number>(token, 'decimals', []),
    ]);
    const decimals = decimalsResult.status === 'fulfilled' ? Number(decimalsResult.value) : NaN;
    tokenMeta.set(token, {
      symbol: symbolResult.status === 'fulfilled' ? String(symbolResult.value || 'TOKEN') : 'TOKEN',
      decimals: Number.isInteger(decimals) && decimals >= 0 && decimals <= 18 ? decimals : null,
    });
  }));

  const totalGross = [...statsByWallet.values()].reduce((sum, row) => sum + row.gross, 0n);
  const rows = [...statsByWallet.entries()]
    .map(([wallet, stats]) => ({
      wallet: wallet.startsWith('0x') ? toAse1(wallet) : wallet,
      deploys: stats.deploys.size,
      fills: stats.fills,
      escrowWei: stats.escrow.toString(),
      grossAseWei: stats.gross.toString(),
      sharePct: totalGross > 0n ? Number((stats.gross * 10000n) / totalGross) / 100 : 0,
      tokenInputs: [...stats.inputs.entries()].map(([token, amount]) => ({
        token: token.startsWith('0x') ? toAse1(token) : token,
        symbol: tokenMeta.get(token)?.symbol ?? 'TOKEN',
        decimals: tokenMeta.get(token)?.decimals ?? null,
        amount: amount.toString(),
      })),
      strategies: [...stats.deploys],
    }))
    .sort((a, b) => {
      const diff = BigInt(b.grossAseWei) - BigInt(a.grossAseWei);
      if (diff !== 0n) return diff > 0n ? 1 : -1;
      return b.deploys - a.deploys;
    });

  return { rows, fromBlock, toBlock: heads.finalized, indexedHub, skippedUnverified };
}
