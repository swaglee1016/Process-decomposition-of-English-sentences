const test=require('node:test');const assert=require('node:assert/strict');
const good={sentenceType:'简单句',translation:'她等着。',parts:[{text:'She waited.',role:'主句',translation:'她等着。'}]};
test('source mismatch triggers one targeted repair then succeeds without changing the sentence',async()=>{
 const {analyzeValidated}=require('../services/validatedAnalysis');const calls=[];
 const result=await analyzeValidated('She waited.',async(sentence,options)=>{calls.push({sentence,options});return calls.length===1?{...good,parts:[{text:'She left.',role:'主句',translation:'她离开'}]}:good;});
 assert.equal(calls.length,2);assert.equal(calls[1].sentence,'She waited.');assert.equal(calls[1].options.repair,true);assert.match(calls[1].options.reason,/原文/);assert.equal(result.translation,'她等着。');
});
test('invalid repair stays rejected after two attempts and authentication errors do not retry',async()=>{
 const {analyzeValidated}=require('../services/validatedAnalysis');let count=0;
 await assert.rejects(()=>analyzeValidated('She waited.',async()=>{count++;return {...good,parts:[{text:'She left.',role:'主句',translation:'她离开'}]};}),/原文/);assert.equal(count,2);
 count=0;await assert.rejects(()=>analyzeValidated('She waited.',async()=>{count++;throw Object.assign(new Error('authentication'),{code:'DEEPSEEK_AUTH_FAILED'});}),/authentication/);assert.equal(count,1);
});
