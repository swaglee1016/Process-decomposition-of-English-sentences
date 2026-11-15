(function(root){
  'use strict';
  function normalizeWord(value){
    if(typeof value!=='string')throw new Error('请选择一个英文单词');
    const word=value.trim().normalize('NFKC').replace(/’/g,"'").toLowerCase();
    if(word.length>64||!/^[a-z]+(?:['-][a-z]+)*$/.test(word))throw new Error('请选择一个英文单词（可包含连字符或撇号）');
    return word;
  }
  const nounGroups=['child children','man men','woman women','person people','foot feet','tooth teeth','mouse mice','goose geese','ox oxen','knife knives','life lives','wife wives','leaf leaves','wolf wolves'];
  const verbGroups=['be am is are was were been being','have has had having','do does did done doing','go goes went gone going','run runs ran running','see sees saw seen seeing','write writes wrote written writing','take takes took taken taking','give gives gave given giving','get gets got gotten getting','make makes made making','come comes came coming','say says said saying','eat eats ate eaten eating','think thinks thought thinking','bring brings brought bringing','buy buys bought buying','find finds found finding','feel feels felt feeling','keep keeps kept keeping','stand stands stood standing','fall falls fell fallen falling','read reads reading'];
  function plural(word){return /[^aeiou]y$/.test(word)?word.slice(0,-1)+'ies':/(?:s|x|z|ch|sh)$/.test(word)?word+'es':word+'s';}
  function doubled(word){return word.length<=4&&/^[a-z]*[aeiou][^aeiouwxy]$/.test(word)?word+word.at(-1):word;}
  function wordForms(entry){
    const word=normalizeWord(typeof entry==='string'?entry:entry.word),dictionary=typeof entry==='string'?null:entry.dictionary;
    const meanings=Array.isArray(dictionary?.meanings)?dictionary.meanings:[],parts=new Set(meanings.map(item=>item.partOfSpeech));
    const forms=new Set([word]),bases=new Set([word]);
    for(const meaning of meanings)for(const definition of meaning.definitions||[]){const lemma=definition.definition?.match(/\b(?:past tense(?: and past participle)?|past participle|plural)(?: form)? of ([a-z]+)\b/i)?.[1];if(lemma)bases.add(lemma.toLowerCase());}
    for(const value of Array.isArray(dictionary?.inflections)?dictionary.inflections.slice(0,32):[])try{forms.add(normalizeWord(value));}catch{}
    for(const base of bases){
      forms.add(base);
      if(parts.has('noun')||!parts.size){const group=nounGroups.find(group=>group.split(' ').includes(base));if(group)for(const value of group.split(' '))forms.add(value);else forms.add(plural(base));}
      if(parts.has('verb')||parts.has('auxiliary verb')||parts.has('modal verb')){
        const group=verbGroups.find(group=>group.split(' ').includes(base));
        if(group)for(const value of group.split(' '))forms.add(value);
        else{forms.add(plural(base));forms.add(/e$/.test(base)?base+'d':/[^aeiou]y$/.test(base)?base.slice(0,-1)+'ied':doubled(base)+'ed');forms.add(/ie$/.test(base)?base.slice(0,-2)+'ying':/[^eoy]e$/.test(base)?base.slice(0,-1)+'ing':doubled(base)+'ing');}
      }
      if(parts.has('adjective')||parts.has('adverb')){
        const group=['good better best','bad worse worst','far farther farthest further furthest'].find(group=>group.split(' ').includes(base));
        if(group)for(const value of group.split(' '))forms.add(value);
        else if(base.length<=5){const stem=/[^aeiou]y$/.test(base)?base.slice(0,-1)+'i':/e$/.test(base)?base.slice(0,-1):doubled(base);forms.add(stem+'er');forms.add(stem+'est');}
      }
    }
    for(const value of [...forms]){forms.add(value+"'s");if(value.endsWith('s'))forms.add(value+"'");}
    return {word,forms};
  }
  function buildWordIndex(words){
    const entries=[...words].map(wordForms),index=new Map();
    for(const entry of entries)index.set(entry.word,entry.word);
    for(const entry of entries)for(const form of entry.forms)if(!index.has(form))index.set(form,entry.word);
    return index;
  }
  function findVocabularyWord(word,words){return buildWordIndex(words).get(normalizeWord(word))||null;}
  function wordRuns(text,words){
    const known=words instanceof Map?words:buildWordIndex(words),runs=[];let cursor=0;
    for(const match of String(text).matchAll(/[A-Za-z]+(?:['’\-][A-Za-z]+)*/g)){
      if(!known.has(normalizeWord(match[0])))continue;
      if(match.index>cursor)runs.push({text:text.slice(cursor,match.index),word:null});
      runs.push({text:match[0],word:known.get(normalizeWord(match[0]))});cursor=match.index+match[0].length;
    }
    if(cursor<text.length)runs.push({text:text.slice(cursor),word:null});
    return runs;
  }
  const api={normalizeWord,wordRuns,buildWordIndex,findVocabularyWord};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.VocabularyShared=api;
})(typeof globalThis!=='undefined'?globalThis:this);
