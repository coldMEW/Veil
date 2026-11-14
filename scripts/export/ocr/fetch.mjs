import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const manifest=JSON.parse(await readFile(new URL('./manifest.json',import.meta.url),'utf8'));
const directory=new URL('../../../public/models/ocr/',import.meta.url);await mkdir(directory,{recursive:true});
const variant=process.argv.includes('--det')?process.argv[process.argv.indexOf('--det')+1]:'v3';
if(!['v3','v5'].includes(variant))throw new Error('Use --det v3 or v5');
for(const file of manifest.files.filter(f=>!f.variant||f.variant===variant)){
 const target=new URL(file.name,directory);
 const valid=bytes=>bytes.length===file.bytes&&createHash('sha256').update(bytes).digest('hex')===file.sha256;
 try{if(valid(await readFile(target))){console.log(file.name+': verified cached');continue;}}catch{}
 const response=await fetch(file.upstreamUrl);if(!response.ok)throw new Error(`${file.name}: HTTP ${response.status}`);
 const bytes=Buffer.from(await response.arrayBuffer());if(!valid(bytes))throw new Error(file.name+': checksum/size mismatch');
 const temporary=new URL(file.name+'.partial',directory);await writeFile(temporary,bytes);await rename(temporary,target);console.log(file.name+': downloaded and verified');
}
