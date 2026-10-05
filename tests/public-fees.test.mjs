import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {feeTotal,sellerNet} from '../scripts/core.mjs';
import {validatePublicFeeEvidence,validateFeeObservations} from '../scripts/probe.mjs';

test('bundled live original-CNY fee evidence agrees with the independent integer model',()=>{
  const raw=readFileSync(new URL('../android/app/src/main/assets/steam-cny-fee-evidence.json',import.meta.url),'utf8');
  const input=JSON.parse(raw);
  const profile=validatePublicFeeEvidence(input,raw);
  assert.equal(profile.verified,true);assert.equal(profile.count,6);
  assert.equal(input.evidenceType,'steam_public_original_cny_listings');
  assert.equal(input.currency,'CNY');assert.equal(input.viewPreference,'bMarketOptOut=1');
  assert.deepEqual(input.wallet,{minimumCents:7,incrementCents:1,steamBasisPoints:500,publisherBasisPoints:1000});
  assert.deepEqual(input.observations.map(x=>x.sellerReceivesCents),[7,46,49479,49566,50000,51044]);
  for(const row of input.observations){
    const url=new URL(row.sourceUrl);
    assert.equal(url.origin,'https://steamcommunity.com');
    assert.equal(decodeURIComponent(url.pathname),'/market/listings/730/'+row.steamHashName+'/render/');
    assert.equal(url.searchParams.get('currency'),'23');
    assert.equal(row.originalCurrencyId,2023);assert.equal(row.convertedCurrencyId,2023);
    assert.equal(row.publisherAppId,730);assert.equal(row.assetHashConfirmed,true);
    assert.ok(Math.abs(Number(row.publisherFeePercent)-0.10)<0.00000001);
    assert.ok(Date.parse(input.observedAt)-Date.parse(row.collectedAt)>=0);
    assert.ok(Date.parse(input.observedAt)-Date.parse(row.collectedAt)<=900000);
    const fee=feeTotal(row.sellerReceivesCents,input.wallet);
    assert.equal(fee.steamFeeCents,row.steamFeeCents);
    assert.equal(fee.publisherFeeCents,row.publisherFeeCents);
    assert.equal(fee.grossCents,row.buyerPaysCents);
    assert.equal(sellerNet(row.buyerPaysCents,input.wallet).netCents,row.sellerReceivesCents);
  }
});

test('public fee source guard rejects converted currency, wrong source and fake external labels',()=>{
  const raw=readFileSync(new URL('../android/app/src/main/assets/steam-cny-fee-evidence.json',import.meta.url),'utf8');
  const input=JSON.parse(raw);
  for(const change of [{originalCurrencyId:2001},{publisherAppId:570},{assetHashConfirmed:false},
    {sourceUrl:input.observations[0].sourceUrl.replace('steamcommunity.com','example.invalid')},
    {publisherFeePercent:'0.20'},{collectedAt:'2026-10-01T00:00:00Z'}]){
    const copy=structuredClone(input);Object.assign(copy.observations[0],change);
    assert.throws(()=>validatePublicFeeEvidence(copy,raw),{code:'fee_source_unverified'});
  }
  const badWallet=structuredClone(input);badWallet.wallet.minimumCents=1;
  assert.throws(()=>validatePublicFeeEvidence(badWallet,raw),{code:'fee_mismatch'});
  const duplicate=structuredClone(input);duplicate.observations=Array(6).fill(duplicate.observations[0]);
  assert.throws(()=>validatePublicFeeEvidence(duplicate,raw),{code:'fee_coverage'});
  assert.throws(()=>validateFeeObservations({...input,attestedRealObservations:true,walletParametersConfirmed:true}),{code:'fee_observations_missing'});
});
