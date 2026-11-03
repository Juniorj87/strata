// Strata template: dca - recurring buy DCA for Auras AMM and AseDex.
// init(poolId, token, buySizeAseWei, totalBudgetAseWei, intervalSec, ammAddress)
// msg.value must include totalBudgetAseWei + cron escrow.
const AURAS_AMM = '0x63f640a9b98b6f28e06cb5cc0fce5d72b6c0eabd';
const ASEDEX_AMM = '0xc3833b73eb30242289e533b3e97c4b72b97e24e9';
const CRON='0x0000000000000000000000000000000000000006';
const NATIVE='0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const CRON_ESCROW=700000n, SLIPPAGE_BPS=200n;
function asObject(value){return typeof value==='string'?JSON.parse(value):value;}
function assertAsePool(poolId,token,ammAddress){const amm=ammAddress||(typeof storage!=='undefined'&&storage.get('ammAddress'))||AURAS_AMM;const p=asObject(E(amm).getPool(String(poolId)));assert(p&&typeof p==='object','AMM pool not found');const t=String(token).toLowerCase(),t0=String(p.token0||'').toLowerCase(),t1=String(p.token1||'').toLowerCase();assert((t0===t&&t1===NATIVE)||(t1===t&&t0===NATIVE),'selected pool must pair this token directly with native ASE');const r0=BigInt(p.reserve0||'0'),r1=BigInt(p.reserve1||'0');assert(r0>0n&&r1>0n,'pool has no liquidity');}
function activeJob(id){if(!id)return false;const raw=E(CRON).getJob(id);if(raw==null)return false;return typeof raw==='string'?JSON.parse(raw)!==null:true;}
function stopCron(reason){const id=storage.get('jobId')||'';if(activeJob(id))E(CRON).cancel(id);storage.set('stopped','true');emit('AutoStopped',{reason,jobId:id});}
({
  init(poolId,token,buySizeAseWei,totalBudgetAseWei,intervalSec,ammAddress){
  assert(!storage.has('owner'),'already initialised');const size=BigInt(buySizeAseWei),budget=BigInt(totalBudgetAseWei),interval=BigInt(intervalSec);
  assert(size>0n&&budget>=size,'invalid buy size or total budget');assert(interval>=60n&&interval<=86400n,'interval must be 60..86400 seconds');
  assert(msg.value>=budget+CRON_ESCROW,'init value must cover ASE DCA budget plus cron escrow');
  const amm=ammAddress||AURAS_AMM;
  assertAsePool(poolId,token,amm);
  storage.set('owner',msg.sender);storage.set('poolId',String(poolId));storage.set('token',String(token));storage.set('ammAddress',String(amm));storage.set('buySizeAseWei',size.toString());storage.set('totalBudgetAseWei',budget.toString());storage.set('spentAseWei','0');storage.set('legs','0');storage.set('intervalSec',interval.toString());storage.set('stopped','false');
  const ms=interval*1000n;const id=E(CRON,{value:CRON_ESCROW}).schedule(msg.contractAddress,'tick',[],(chain.blockTimestamp+ms).toString(),ms.toString(),'0','700000');storage.set('jobId',String(id));
  emit('StrataDeploy',{owner:msg.sender,template:'dca',poolId:String(poolId),intervalSec:interval.toString(),timestamp:chain.blockTimestamp.toString()});emit('DcaConfigured',{buySizeAseWei:size.toString(),totalBudgetAseWei:budget.toString(),jobId:String(id)});return String(id);
},
  tick(){
  assert(msg.sender===CRON,'only cron registry');assert(storage.get('stopped')!=='true','strategy stopped');
  const ammAddress=storage.get('ammAddress')||AURAS_AMM;
  const spent=BigInt(storage.get('spentAseWei')),budget=BigInt(storage.get('totalBudgetAseWei')),size=BigInt(storage.get('buySizeAseWei'));
  const amount=size<budget-spent?size:budget-spent;if(amount<=0n){stopCron('dca-budget-exhausted');return 'stopped';}
  const pool=storage.get('poolId');const expected=BigInt(E(ammAddress).quote(pool,NATIVE,amount.toString()));assert(expected>0n,'buy quote is zero');
  const minOut=expected*(10000n-SLIPPAGE_BPS)/10000n;const out=BigInt(E(ammAddress,{value:amount}).swapExactIn(pool,NATIVE,amount.toString(),minOut.toString()));
  const next=BigInt(storage.get('legs'))+1n;storage.set('legs',next.toString());storage.set('spentAseWei',(spent+amount).toString());
  emit('Fill',{side:'buy',poolId:pool,tokenIn:NATIVE,amountIn:amount.toString(),tokenOut:storage.get('token'),amountOut:out.toString(),leg:next.toString(),remainingBudgetAseWei:(budget-spent-amount).toString()});
  if(spent+amount>=budget)stopCron('dca-budget-exhausted');return out.toString();
},
  stop(){assert(msg.sender===storage.get('owner'),'not the owner');if(storage.get('stopped')!=='true')stopCron('owner-emergency-stop');return true;},
  withdraw(to,amountWei){assert(msg.sender===storage.get('owner'),'not the owner');assert(storage.get('stopped')==='true','stop the strategy before withdrawing ASE');const amount=BigInt(amountWei);assert(amount>0n,'amount must be positive');transfer(to||msg.sender,amount);emit('Withdrawn',{to:to||msg.sender,amount:amount.toString()});return amount.toString();},
  withdrawTokens(to){assert(msg.sender===storage.get('owner'),'not the owner');assert(storage.get('stopped')==='true','stop the strategy first');const token=storage.get('token'),amount=BigInt(E(token).balanceOf(msg.contractAddress));assert(amount>0n,'no tokens to withdraw');E(token).transfer(to||msg.sender,amount.toString());emit('TokensWithdrawn',{token,to:to||msg.sender,amount:amount.toString()});return amount.toString();},
  getOwner(){return storage.get('owner')||'';},getConfig(){return JSON.stringify({version:'2',template:'dca',poolId:storage.get('poolId'),token:storage.get('token'),buySizeAseWei:storage.get('buySizeAseWei'),totalBudgetAseWei:storage.get('totalBudgetAseWei'),intervalSec:storage.get('intervalSec'),ammAddress:storage.get('ammAddress')});},getTemplate(){return 'dca';},getStatus(){return JSON.stringify({owner:storage.get('owner'),template:'dca',poolId:storage.get('poolId'),token:storage.get('token'),stopped:storage.get('stopped'),jobId:storage.get('jobId'),legs:storage.get('legs'),spentAseWei:storage.get('spentAseWei'),totalBudgetAseWei:storage.get('totalBudgetAseWei'),buySizeAseWei:storage.get('buySizeAseWei'),intervalSec:storage.get('intervalSec'),remainingBudgetAseWei:(BigInt(storage.get('totalBudgetAseWei')||'0')-BigInt(storage.get('spentAseWei')||'0')).toString(),ammAddress:storage.get('ammAddress')});}
});
