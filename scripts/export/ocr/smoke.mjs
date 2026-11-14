import {fixture,planted} from './fixture.mjs';
import sharp from 'sharp';
import * as ort from 'onnxruntime-node';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
const args=process.argv.slice(2);const at=args.indexOf('--det');const variant=at<0?'v3':args.splice(at,2)[1];if(!['v3','v5'].includes(variant))throw Error('Use --det v3 or v5');
const tileAt=args.indexOf('--tile');const tileSize=tileAt<0?960:Number(args.splice(tileAt,2)[1]);
const bundle=await build({entryPoints:['src/features/clean/ocr/pipeline.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {scanImage}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const det=await ort.InferenceSession.create(`public/models/ocr/det-${variant}.onnx`,{intraOpNumThreads:4});const rec=await ort.InferenceSession.create('public/models/ocr/rec.onnx',{intraOpNumThreads:4});
const dict=(await readFile('public/models/ocr/dict.txt','utf8')).trimEnd().split('\n').map(x=>x.replace(/\r$/,''));
let detMs=[],recMs=[];const stages={};const profile=(name,ms)=>{stages[name]=(stages[name]??0)+ms;};
const run=(s,times)=>async input=>{const t=performance.now();const tensor=new ort.Tensor('float32',input.data,input.dims);const out=await s.run({x:tensor});times.push(Math.round(performance.now()-t));const result=out[s.outputNames[0]];const value={data:new Float32Array(result.data),dims:[...result.dims]};tensor.dispose();Object.values(out).forEach(t=>t.dispose());return value;};
const models={detect:run(det,detMs),recognize:run(rec,recMs),dictionary:['',...dict,' '],recognitionHeight:48};
try{const input=fixture();let t=performance.now();const boxes=await scanImage(input,models,{tileSize},undefined,profile);const summary={variant,threads:4,tileSize,synthetic:true,stages,totalMs:Math.round(performance.now()-t),passes:detMs.length,sourceTiles:detMs.length-1,detMs,recMs,found:Object.fromEntries(planted.map(p=>[p.text,boxes.some(b=>b.text===p.text)])),boxes:boxes.length};console.log(JSON.stringify(summary));
if(args[0]){detMs.length=0;recMs.length=0;const {data,info}=await sharp(args[0]).rotate().ensureAlpha().raw().toBuffer({resolveWithObject:true});t=performance.now();const result=await scanImage({data,width:info.width,height:info.height},models,{tileSize});console.log(JSON.stringify({variant,private:true,boxes:result.length,multiCharacterWords:result.filter(b=>b.text.trim().length>=3).length,totalMs:Math.round(performance.now()-t),passes:detMs.length,detMs,recMs}));}
if(!summary.found['221B BAKER ST'])process.exitCode=1;
}finally{await det.release();await rec.release();}
