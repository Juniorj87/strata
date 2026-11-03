// Strata template: grid - two-sided inventory grid for Auras AMM and AseDex.
// init(poolId, token, stepBps, levels, sellSizeWei, sellBudgetWei, buySizeAseWei, buyBudgetAseWei, decimals, ammAddress)
// The owner funds the contract with ARC-20 inventory after init and sends
// buyBudgetAseWei + cronEscrow as init msg.value. Each level is executed once.
const AURAS_AMM = '0x63f640a9b98b6f28e06cb5cc0fce5d72b6c0eabd';
const ASEDEX_AMM = '0xc3833b73eb30242289e533b3e97c4b72b97e24e9';
const CRON = '0x0000000000000000000000000000000000000006';
const NATIVE = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const CRON_ESCROW = 800000n;
const SLIPPAGE_BPS = 200n;
function activeJob(id) { if (!id) return false; const raw = E(CRON).getJob(id); if (raw == null) return false; return typeof raw === 'string' ? JSON.parse(raw) !== null : true; }
function stopCron(reason) { const id = storage.get('jobId') || ''; if (activeJob(id)) E(CRON).cancel(id); storage.set('stopped', 'true'); emit('AutoStopped', { reason, jobId: id }); }
function asObject(value) { return typeof value === 'string' ? JSON.parse(value) : value; }
function readAsePrice(poolId, token, decimals, ammAddress) {
  const amm = ammAddress || (typeof storage !== 'undefined' && storage.get('ammAddress')) || AURAS_AMM;
  const pool = asObject(E(amm).getPool(String(poolId)));
  assert(pool && typeof pool === 'object', 'AMM pool not found');
  const asset = String(token).toLowerCase();
  const token0 = String(pool.token0 || '').toLowerCase();
  const token1 = String(pool.token1 || '').toLowerCase();
  const reserve0 = BigInt(pool.reserve0 || '0');
  const reserve1 = BigInt(pool.reserve1 || '0');
  let tokenReserve;
  let aseReserve;
  if (token0 === asset && token1 === NATIVE) {
    tokenReserve = reserve0;
    aseReserve = reserve1;
  } else if (token1 === asset && token0 === NATIVE) {
    tokenReserve = reserve1;
    aseReserve = reserve0;
  } else {
    assert(false, 'selected pool must pair this token directly with native ASE');
  }
  assert(tokenReserve > 0n && aseReserve > 0n, 'pool has no liquidity');
  // ASE wei per one whole token; correct whichever side the token occupies.
  return (aseReserve * (10n ** BigInt(decimals))) / tokenReserve;
}

({
  init(poolId, token, stepBps, levels, sellSizeWei, sellBudgetWei, buySizeAseWei, buyBudgetAseWei, decimals, ammAddress) {
    assert(!storage.has('owner'), 'already initialised');
    const step=BigInt(stepBps), count=BigInt(levels), sell=BigInt(sellSizeWei), sellBudget=BigInt(sellBudgetWei), buy=BigInt(buySizeAseWei), budget=BigInt(buyBudgetAseWei), tokenDecimals=BigInt(decimals);
    assert(step>0n && step<=5000n, 'step must be 1..5000 bps');
    assert(count>=1n && count<=20n, 'levels must be 1..20');
    assert(step*count<10000n, 'step multiplied by levels must stay below 10000 bps');
    assert(tokenDecimals>=0n && tokenDecimals<=18n, 'invalid token decimals');
    assert(sell>0n && sellBudget>=sell*count && buy>0n && budget>=buy*count, 'each side budget must cover every configured grid level');
    assert(msg.value>=budget+CRON_ESCROW, 'init value must cover ASE buy budget plus cron escrow');
    const amm = ammAddress || AURAS_AMM;
    const center=readAsePrice(poolId,token,Number(tokenDecimals), amm);
    storage.set('owner',msg.sender); storage.set('poolId',String(poolId)); storage.set('token',String(token)); storage.set('ammAddress',String(amm));
    storage.set('stepBps',step.toString()); storage.set('levels',count.toString()); storage.set('tokenDecimals',tokenDecimals.toString());
    storage.set('sellSizeWei',sell.toString()); storage.set('sellBudgetWei',sellBudget.toString()); storage.set('buySizeAseWei',buy.toString());
    storage.set('buyBudgetAseWei',budget.toString()); storage.set('buySpentAseWei','0'); storage.set('sellSpentWei','0'); storage.set('sellFunded','false');
    storage.set('buyLevel','1'); storage.set('sellLevel','1'); storage.set('center',center.toString());
    storage.set('ticks','0'); storage.set('stopped','false');
    const interval=60000n;
    const id=E(CRON,{value:CRON_ESCROW}).schedule(msg.contractAddress,'tick',[],(chain.blockTimestamp+interval).toString(),interval.toString(),'0','800000');
    storage.set('jobId',String(id));
    emit('StrataDeploy',{owner:msg.sender,template:'grid',poolId:String(poolId),intervalSec:'60',timestamp:chain.blockTimestamp.toString()});
    emit('GridConfigured',{center:center.toString(),stepBps:step.toString(),levels:count.toString(),buyBudgetAseWei:budget.toString(),cronEscrowWei:CRON_ESCROW.toString()});
    return String(id);
  },
  tick() {
    assert(msg.sender===CRON,'only cron registry'); assert(storage.get('stopped')!=='true','strategy stopped');
    const ammAddress=storage.get('ammAddress')||AURAS_AMM;
    const price=readAsePrice(storage.get('poolId'),storage.get('token'),Number(storage.get('tokenDecimals')),ammAddress), center=BigInt(storage.get('center'));
    const step=BigInt(storage.get('stepBps')), levels=BigInt(storage.get('levels'));
    const buyLevel=BigInt(storage.get('buyLevel')), sellLevel=BigInt(storage.get('sellLevel'));
    if (storage.get('sellFunded') !== 'true') {
      const initialSellBalance = BigInt(E(storage.get('token')).balanceOf(msg.contractAddress));
      const requiredSellBalance = BigInt(storage.get('sellBudgetWei'));
      if (initialSellBalance < requiredSellBalance) { stopCron('sell-inventory-underfunded'); return 'stopped'; }
      storage.set('sellFunded','true');
    }
    storage.set('ticks',(BigInt(storage.get('ticks')||'0')+1n).toString());
    if (buyLevel<=levels) {
      const trigger=center*(10000n-step*buyLevel)/10000n;
      if (price<=trigger) {
        const spent=BigInt(storage.get('buySpentAseWei')), budget=BigInt(storage.get('buyBudgetAseWei'));
        const amount=BigInt(storage.get('buySizeAseWei')) < budget-spent ? BigInt(storage.get('buySizeAseWei')) : budget-spent;
        if (amount<=0n) { storage.set('buyLevel',(levels+1n).toString()); }
        else {
          const expected=BigInt(E(ammAddress).quote(storage.get('poolId'),NATIVE,amount.toString()));
          assert(expected>0n,'buy quote is zero');
          const minOut=expected*(10000n-SLIPPAGE_BPS)/10000n;
          const out=BigInt(E(ammAddress,{value:amount}).swapExactIn(storage.get('poolId'),NATIVE,amount.toString(),minOut.toString()));
          storage.set('buySpentAseWei',(spent+amount).toString()); storage.set('buyLevel',(buyLevel+1n).toString());
          emit('Fill',{side:'buy',poolId:storage.get('poolId'),tokenIn:NATIVE,amountIn:amount.toString(),tokenOut:storage.get('token'),amountOut:out.toString(),level:buyLevel.toString()});
          return out.toString();
        }
      }
    }
    if (sellLevel<=levels) {
      const trigger=center*(10000n+step*sellLevel)/10000n;
      if (price>=trigger) {
        const token=storage.get('token'), requested=BigInt(storage.get('sellSizeWei'));
        const balance=BigInt(E(token).balanceOf(msg.contractAddress));
        const sellSpent=BigInt(storage.get('sellSpentWei')||'0');
        const sellRemaining=BigInt(storage.get('sellBudgetWei'))-sellSpent;
        const amount=[balance,requested,sellRemaining].reduce((smallest,value)=>value<smallest?value:smallest);
        if (amount<=0n) { stopCron('sell-inventory-exhausted'); return 'stopped'; }
        E(token).approve(ammAddress,amount.toString());
        const expected=BigInt(E(ammAddress).quote(storage.get('poolId'),token,amount.toString()));
        assert(expected>0n,'sell quote is zero');
        const minOut=expected*(10000n-SLIPPAGE_BPS)/10000n;
        const out=BigInt(E(ammAddress).swapExactIn(storage.get('poolId'),token,amount.toString(),minOut.toString()));
        storage.set('sellSpentWei',(sellSpent+amount).toString());
        storage.set('sellLevel',(sellLevel+1n).toString());
        emit('Fill',{side:'sell',poolId:storage.get('poolId'),tokenIn:token,amountIn:amount.toString(),tokenOut:NATIVE,amountOut:out.toString(),level:sellLevel.toString()});
        return out.toString();
      }
    }
    if (buyLevel>levels && sellLevel>levels) stopCron('all-grid-levels-used');
    emit('Signal',{signal:'hold',price:price.toString(),center:center.toString(),buyLevel:buyLevel.toString(),sellLevel:sellLevel.toString()});
    return 'hold';
  },
  stop(){ assert(msg.sender===storage.get('owner'),'not the owner'); if(storage.get('stopped')!=='true') stopCron('owner-emergency-stop'); return true; },
  withdraw(to,amountWei){ assert(msg.sender===storage.get('owner'),'not the owner'); assert(storage.get('stopped')==='true','stop the strategy before withdrawing ASE'); const amount=BigInt(amountWei); assert(amount>0n,'amount must be positive'); transfer(to||msg.sender,amount); emit('Withdrawn',{to:to||msg.sender,amount:amount.toString()}); return amount.toString(); },
  withdrawTokens(to){ assert(msg.sender===storage.get('owner'),'not the owner'); assert(storage.get('stopped')==='true','stop the strategy first'); const token=storage.get('token'), amount=BigInt(E(token).balanceOf(msg.contractAddress)); assert(amount>0n,'no tokens to withdraw'); E(token).transfer(to||msg.sender,amount.toString()); emit('TokensWithdrawn',{token,to:to||msg.sender,amount:amount.toString()}); return amount.toString(); },
  getOwner(){return storage.get('owner')||'';},
  getConfig(){return JSON.stringify({version:'2',template:'grid',poolId:storage.get('poolId'),token:storage.get('token'),stepBps:storage.get('stepBps'),levels:storage.get('levels'),sellSizeWei:storage.get('sellSizeWei'),budgetWei:storage.get('sellBudgetWei'),buySizeAseWei:storage.get('buySizeAseWei'),buyBudgetAseWei:storage.get('buyBudgetAseWei'),decimals:storage.get('tokenDecimals'),ammAddress:storage.get('ammAddress')});},
  getTemplate(){return 'grid';},
  getStatus(){return JSON.stringify({owner:storage.get('owner'),template:'grid',poolId:storage.get('poolId'),token:storage.get('token'),stopped:storage.get('stopped'),jobId:storage.get('jobId'),ticks:storage.get('ticks'),center:storage.get('center'),buyLevel:storage.get('buyLevel'),sellLevel:storage.get('sellLevel'),buySpentAseWei:storage.get('buySpentAseWei'),buyBudgetAseWei:storage.get('buyBudgetAseWei'),sellSpentWei:storage.get('sellSpentWei'),sellBudgetWei:storage.get('sellBudgetWei'),decimals:storage.get('tokenDecimals'),ammAddress:storage.get('ammAddress')});}
});
