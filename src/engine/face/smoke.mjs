import { build } from 'esbuild';
import * as ort from 'onnxruntime-node';
import { readFile } from 'node:fs/promises';
await build({entryPoints:['src/engine/face/math.ts'],outfile:'public/models/face/math-smoke.mjs',bundle:true,platform:'node',format:'esm'});
const m=await import('../../../public/models/face/math-smoke.mjs');
const manifest=JSON.parse(await readFile(new URL('./models.json',import.meta.url)));
const image={width:112,height:112,data:new Uint8ClampedArray(112*112*4)};
for(let i=0;i<image.data.length;i+=4){image.data[i]=90+(i%89);image.data[i+1]=130;image.data[i+2]=70;image.data[i+3]=255;}
const face={box:{x:0,y:0,w:1,h:1},score:1,landmarks:m.ARC_TEMPLATE.map(([x,y])=>[x/112,y/112])};
for(const id of ['yunet','sface']){
 const started=performance.now();
 const session=await ort.InferenceSession.create('public'+manifest[id].servedAs,{executionProviders:['cpu'],intraOpNumThreads:4,logSeverityLevel:3});
 const prepared=m.detectorTensor(image);
 const tensor=new ort.Tensor('float32',id==='yunet'?prepared.data:m.alignedTensor(image,face),[1,3,id==='yunet'?640:112,id==='yunet'?640:112]);
 const out=await session.run({[session.inputNames[0]]:tensor});
 const detail=id==='yunet'?{faces:m.decodeYuNet(Object.fromEntries(Object.entries(out).map(([k,v])=>[k,v.data])),112,112,prepared.scaleX,prepared.scaleY).length}:{dimensions:128,norm:Math.hypot(...m.unitVector(out[session.outputNames[0]].data))};
 console.log(JSON.stringify({model:id,...detail,ms:Math.round(performance.now()-started)}));
 tensor.dispose();Object.values(out).forEach(x=>x.dispose());await session.release();
}
