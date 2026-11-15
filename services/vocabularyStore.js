const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {normalizeWord}=require('../public/vocabularyShared');
class VocabularyStore{
  constructor(filename){
    if(filename!==':memory:')fs.mkdirSync(path.dirname(filename),{recursive:true});
    this.db=new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS vocabulary_words(term TEXT PRIMARY KEY,display TEXT NOT NULL,context TEXT NOT NULL,source TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,revision INTEGER NOT NULL DEFAULT 1,dictionary_json TEXT,audio_data_uri TEXT,lookup_error TEXT NOT NULL DEFAULT '');
      CREATE TABLE IF NOT EXISTS vocabulary_actions(id TEXT PRIMARY KEY,term TEXT NOT NULL,revision INTEGER NOT NULL,undone INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS vocabulary_capabilities(hash TEXT PRIMARY KEY,created_at TEXT NOT NULL);
    `);
  }
  transaction(action){this.db.exec('BEGIN IMMEDIATE');try{const result=action();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
  decode(row,includeAudio=false){
    if(!row)return null;
    const entry={word:row.term,display:row.display,context:row.context,source:row.source,createdAt:row.created_at,updatedAt:row.updated_at,dictionary:row.dictionary_json?JSON.parse(row.dictionary_json):null,lookupError:row.lookup_error,audioCached:!!row.audio_cached};
    if(includeAudio)entry.audioDataUri=row.audio_data_uri||null;
    return entry;
  }
  list(){return this.db.prepare('SELECT term,display,context,source,created_at,updated_at,dictionary_json,lookup_error,audio_data_uri IS NOT NULL AS audio_cached FROM vocabulary_words WHERE active=1 ORDER BY created_at DESC,term').all().map(row=>this.decode(row));}
  detail(word,includeInactive=false){return this.decode(this.db.prepare('SELECT *,audio_data_uri IS NOT NULL AS audio_cached FROM vocabulary_words WHERE term=? AND (?=1 OR active=1)').get(normalizeWord(word),includeInactive?1:0),true);}
  remove(word){const term=normalizeWord(word);const result=this.db.prepare('UPDATE vocabulary_words SET active=0,revision=revision+1,updated_at=? WHERE term=? AND active=1').run(new Date().toISOString(),term);return {removed:result.changes===1,word:term};}
  add({word,context='',source=''}){
    const term=normalizeWord(word);
    if(typeof context!=='string'||context.length>4000)throw new Error('原句不能超过 4000 字符');
    if(typeof source!=='string'||source.length>300)throw new Error('文章来源不能超过 300 字符');
    return this.transaction(()=>{
      const existing=this.db.prepare('SELECT active,revision FROM vocabulary_words WHERE term=?').get(term);
      if(existing?.active)return {entry:this.detail(term),created:false,actionId:null};
      const now=new Date().toISOString(),revision=existing?existing.revision+1:1;
      this.db.prepare(`INSERT INTO vocabulary_words(term,display,context,source,created_at,updated_at,active,revision) VALUES(?,?,?,?,?,?,1,?) ON CONFLICT(term) DO UPDATE SET display=excluded.display,context=excluded.context,source=excluded.source,created_at=excluded.created_at,updated_at=excluded.updated_at,active=1,revision=excluded.revision`).run(term,word.trim(),context,source,now,now,revision);
      const actionId=crypto.randomUUID();this.db.prepare('INSERT INTO vocabulary_actions(id,term,revision) VALUES(?,?,?)').run(actionId,term,revision);
      return {entry:this.detail(term),created:true,actionId};
    });
  }
  undo(actionId){
    if(typeof actionId!=='string'||!/^[0-9a-f-]{36}$/.test(actionId))throw new Error('撤销操作无效');
    return this.transaction(()=>{
      const action=this.db.prepare('SELECT * FROM vocabulary_actions WHERE id=?').get(actionId);
      if(!action||action.undone)return {undone:false};
      const result=this.db.prepare('UPDATE vocabulary_words SET active=0,revision=revision+1,updated_at=? WHERE term=? AND active=1 AND revision=?').run(new Date().toISOString(),action.term,action.revision);
      this.db.prepare('UPDATE vocabulary_actions SET undone=1 WHERE id=?').run(actionId);
      return {undone:result.changes===1,word:action.term};
    });
  }
  updateLookup(word,{dictionary=null,audioDataUri=null,error=''}){
    const term=normalizeWord(word),encoded=dictionary?JSON.stringify(dictionary):null;
    if(encoded&&Buffer.byteLength(encoded)>512*1024)throw new Error('词典内容超过限制');
    if(audioDataUri&&(!/^data:audio\/mpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(audioDataUri)||audioDataUri.length>1500000))throw new Error('发音录音无效');
    this.db.prepare('UPDATE vocabulary_words SET dictionary_json=?,audio_data_uri=?,lookup_error=?,updated_at=? WHERE term=?').run(encoded,audioDataUri,String(error).slice(0,300),new Date().toISOString(),term);
    return this.detail(term);
  }
  snapshot(){
    const words=this.list();let audioBytes=0;
    for(const entry of words){
      if(!entry.audioCached)continue;
      const row=this.db.prepare('SELECT audio_data_uri FROM vocabulary_words WHERE term=?').get(entry.word);
      if(audioBytes+row.audio_data_uri.length<=8*1024*1024){entry.audioDataUri=row.audio_data_uri;audioBytes+=row.audio_data_uri.length;}
    }
    return {words,savedAt:new Date().toISOString()};
  }
  issueCapability(){const token=crypto.randomBytes(32).toString('hex');this.db.prepare('INSERT INTO vocabulary_capabilities(hash,created_at) VALUES(?,?)').run(crypto.createHash('sha256').update(token).digest('hex'),new Date().toISOString());return token;}
  authorize(token){return typeof token==='string'&&/^[0-9a-f]{64}$/.test(token)&&!!this.db.prepare('SELECT hash FROM vocabulary_capabilities WHERE hash=?').get(crypto.createHash('sha256').update(token).digest('hex'));}
  close(){this.db.close();}
}
module.exports={VocabularyStore};
