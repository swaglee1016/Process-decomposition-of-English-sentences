const test=require('node:test');const assert=require('node:assert/strict');
test('dictionary JSON mode is opt-in and does not change ordinary analysis requests',async()=>{
 const previous=process.env.DEEPSEEK_API_KEY,originalFetch=global.fetch;process.env.DEEPSEEK_API_KEY='synthetic-test-key';const file=require.resolve('../services/deepseek');delete require.cache[file];const bodies=[];
 global.fetch=async(url,options)=>{bodies.push(JSON.parse(options.body));return {ok:true,json:async()=>({choices:[{message:{content:'{}'}}]})};};
 try{const {callDeepSeek}=require('../services/deepseek');await callDeepSeek('Return JSON','word',0.1,1000,0,{json:true});await callDeepSeek('ordinary','sentence',0.1,1000,0);assert.deepEqual(bodies[0].response_format,{type:'json_object'});assert.equal(bodies[1].response_format,undefined);}finally{global.fetch=originalFetch;if(previous===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=previous;delete require.cache[file];}
});
