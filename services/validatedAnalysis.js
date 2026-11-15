const {parseAnalysis}=require('./orderedAnalysis');
function validationReason(error){
 const message=error.message||'';
 if(/does not occur/.test(message))return '模型片段改写了原文';
 if(/do not cover/.test(message))return '模型遗漏了原句中的词';
 if(/overlap/.test(message))return '模型片段相互重叠';
 if(/search limit/.test(message))return '重复片段无法确定对应位置';
 return '模型返回的 JSON 或字段格式不符合要求';
}
async function analyzeValidated(sentence,analyzeSentence,onRepair=()=>{}){
 let failure;
 for(let attempt=0;attempt<2;attempt++){
  // Transport/authentication failures retain their original safe errors.
  const raw=await analyzeSentence(sentence,attempt?{repair:true,reason:failure}:undefined);
  try{return parseAnalysis(raw,sentence);}
  catch(error){failure=validationReason(error);if(!attempt)await onRepair(failure);}
 }
 throw Object.assign(new Error(failure+'，自动校正后仍未通过'),{code:'ANALYSIS_VALIDATION_FAILED'});
}
module.exports={analyzeValidated,validationReason};
