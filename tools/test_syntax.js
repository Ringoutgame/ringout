// Module-aware syntax check for index.html script blocks.
// Temp .mjs blocks are written to the OS temp dir so tools/ stays clean.
const fs=require('fs'),path=require('path'),os=require('os'),{execSync}=require('child_process');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const re=/<script([^>]*)>([\s\S]*?)<\/script>/g;let m,n=0;
const tmp=[];
try{
  while((m=re.exec(html))){
    n++;const attrs=m[1],src=m[2];
    if(/type\s*=\s*["']importmap["']/.test(attrs)){JSON.parse(src);continue;}
    if(/type\s*=\s*["']module["']/.test(attrs)){
      const f=path.join(os.tmpdir(),'ringout_synchk_'+process.pid+'_'+n+'.mjs');
      fs.writeFileSync(f,src);tmp.push(f);
      execSync('node --check "'+f+'"',{stdio:'inherit'});continue;
    }
    new Function(src);
  }
}finally{
  for(const f of tmp){try{fs.unlinkSync(f);}catch(e){}}
}
console.log('SYNTAX OK ('+n+' Bloecke)');
