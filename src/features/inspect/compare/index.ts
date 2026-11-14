import {align, type Pixels} from './align';
import type {CheckResult,Rect,Overlay} from '../../../contracts';
export type {Pixels,Alignment} from './align';
export interface Region {rect:Rect;meanScore:number;area:number}

function validate(p:Pixels){if(!Number.isInteger(p.width)||!Number.isInteger(p.height)||p.width<16||p.height<16||p.width*p.height>40_000_000||p.data.length!==p.width*p.height*4)throw Error('Invalid comparison RGBA pixels.');}
function blur(src:Float32Array,w:number,h:number,sigma=1.5):Float32Array {
 const radius=Math.ceil(3*sigma),kernel=new Float64Array(2*radius+1);let sum=0;
 for(let i=-radius;i<=radius;i++){kernel[i+radius]=Math.exp(-i*i/(2*sigma*sigma));sum+=kernel[i+radius]!;}
 for(let i=0;i<kernel.length;i++)kernel[i]=kernel[i]!/sum;
 const temp=new Float32Array(src.length),out=new Float32Array(src.length);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){let v=0;for(let i=-radius;i<=radius;i++)v+=src[y*w+Math.max(0,Math.min(w-1,x+i))]!*kernel[i+radius]!;temp[y*w+x]=v;}
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){let v=0;for(let i=-radius;i<=radius;i++)v+=temp[Math.max(0,Math.min(h-1,y+i))*w+x]!*kernel[i+radius]!;out[y*w+x]=v;}
 return out;
}
function rgb(p:Pixels,x:number,y:number,c:number):number{
 x=Math.max(0,Math.min(p.width-1,x));y=Math.max(0,Math.min(p.height-1,y));const ix=Math.floor(x),iy=Math.floor(y),dx=x-ix,dy=y-iy;
 let value=0;for(let j=0;j<2;j++)for(let i=0;i<2;i++){const n=(Math.min(p.height-1,iy+j)*p.width+Math.min(p.width-1,ix+i))*4;value+=p.data[n+c]!*(p.data[n+3]!/255)*(i?dx:1-dx)*(j?dy:1-dy);}return value;
}
function percentile(values:number[],q:number){values.sort((a,b)=>a-b);return values[Math.min(values.length-1,Math.floor(q*values.length))]??0;}
function direction(r:Rect){return `${r.y+r.h/2<.5?'upper':'lower'} ${r.x+r.w/2<.5?'left':'right'}`;}

/** Align and measure content differences; every finding is deliberately inconclusive. */
export function compareImages(a:Pixels,b:Pixels,assetId='comparison'):CheckResult {
 validate(a);validate(b);const start=performance.now(),alignment=align(a,b),alignMs=performance.now()-start;
 const base={id:'compare',assetId,kind:'signal' as const,title:'Differences from the original',execution:'complete' as const,finding:'inconclusive' as const,source:'live' as const,
  method:'Scale-and-translation gradient alignment; blurred colour residuals with robust global normalization.',
  assumptions:['Both images show the same scene; rotation and perspective changes are small.'],
  limitations:['A difference is a measurement between files, not an origin attribution.','Global tone changes are estimated; strong local re-rendering, repeated patterns or viewpoint changes can affect this map.'],
 };
 if(!alignment)return {...base,reason:'Could not align the two images; they may not be the same scene.',observation:'The images could not be aligned for comparison.',evidence:{alignment:null,regions:[],overlapRect:null,timingsMs:{alignment:alignMs,total:performance.now()-start}},overlays:[]};
 const f=Math.min(1,1024/Math.max(b.width,b.height)),width=Math.round(b.width*f),height=Math.round(b.height*f);
 const {scale:s,tx,ty}=alignment;
 const x0=Math.max(0,Math.ceil(tx*f)),y0=Math.max(0,Math.ceil(ty*f));
 const x1=Math.min(width,Math.floor((tx+s*(a.width-1))*f)),y1=Math.min(height,Math.floor((ty+s*(a.height-1))*f));
 const w=x1-x0,h=y1-y0;
 if(w<8||h<8)return {...base,reason:'Could not align the two images; they may not be the same scene.',observation:'Insufficient overlap for comparison.',evidence:{alignment,regions:[]},overlays:[]};
 const warpStart=performance.now(),channelsA:Float32Array[]=[],channelsB:Float32Array[]=[];
 for(let c=0;c<3;c++){
  const aa=new Float32Array(w*h),bb=new Float32Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   const bx=(x+x0)/f,by=(y+y0)/f;aa[y*w+x]=rgb(a,(bx-tx)/s,(by-ty)/s,c);bb[y*w+x]=rgb(b,bx,by,c);
  }
  channelsA.push(blur(aa,w,h));channelsB.push(blur(bb,w,h));
 }
 const warpBlurMs=performance.now()-warpStart,diffStart=performance.now(),residual=new Float32Array(w*h);
 // Robust affine colour matching: trim high-residual object samples before refitting global tone.
 for(let c=0;c<3;c++){
  const aa=channelsA[c]!,bb=channelsB[c]!;let gain=1,offset=0;
  for(let pass=0;pass<2;pass++){
   const errors:number[]=[];for(let i=0;i<aa.length;i+=31)errors.push(Math.abs(bb[i]!-(aa[i]!*gain+offset)));
   const cut=pass?percentile(errors,.8):Infinity;
   let sx=0,sy=0,sxx=0,sxy=0,count=0;
   for(let i=0;i<aa.length;i+=31){const x=aa[i]!,y=bb[i]!;if(Math.abs(y-(x*gain+offset))>cut)continue;sx+=x;sy+=y;sxx+=x*x;sxy+=x*y;count++;}
   gain=Math.max(.5,Math.min(2,(sxy-sx*sy/count)/Math.max(1e-6,sxx-sx*sx/count)));offset=(sy-gain*sx)/count;
  }
  for(let i=0;i<aa.length;i++){const d=(bb[i]!-(aa[i]!*gain+offset))/255;residual[i]=residual[i]!+d*d/3;}
 }
 for(let i=0;i<residual.length;i++)residual[i]=Math.sqrt(residual[i]!);
 // Local mean residual over an8x8window, implemented as a summed-area table.
 const integral=new Float64Array((w+1)*(h+1));
 for(let y=0;y<h;y++){let row=0;for(let x=0;x<w;x++){row+=residual[y*w+x]!;integral[(y+1)*(w+1)+x+1]=integral[y*(w+1)+x+1]!+row;}}
 const local=new Float32Array(w*h),distribution:number[]=[];
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const l=Math.max(0,x-4),r=Math.min(w,x+4),t=Math.max(0,y-4),bt=Math.min(h,y+4);
  const v=(integral[bt*(w+1)+r]!-integral[t*(w+1)+r]!-integral[bt*(w+1)+l]!+integral[t*(w+1)+l]!)/((r-l)*(bt-t));
  local[y*w+x]=v;if((y*w+x)%17===0)distribution.push(v);
 }
 const median=percentile([...distribution],.5),mad=percentile(distribution.map(v=>Math.abs(v-median)),.5);
 const floor=Math.max(.035,median+6*mad),values=new Float32Array(w*h),binary=new Uint8Array(w*h);
 for(let i=0;i<values.length;i++){values[i]=Math.max(0,Math.min(1,(local[i]!-floor)/Math.max(.10,3*mad)));binary[i]=values[i]!>.45?1:0;}
 // Majority filtering removes isolated speckles without extending red into unobserved pixels.
 const clean=new Uint8Array(binary.length);
 for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){let count=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)count+=binary[(y+dy)*w+x+dx]!;clean[y*w+x]=count>=5?1:0;}
 const seen=new Uint8Array(w*h),queue=new Int32Array(w*h),regions:Region[]=[];
 for(let seed=0;seed<clean.length;seed++){
  if(!clean[seed]||seen[seed])continue;let head=0,tail=1,l=w,t=h,r=0,bt=0,total=0;queue[0]=seed;seen[seed]=1;
  while(head<tail){const i=queue[head++]!,x=i%w,y=Math.floor(i/w);l=Math.min(l,x);r=Math.max(r,x);t=Math.min(t,y);bt=Math.max(bt,y);total+=values[i]!;
   for(let yy=Math.max(0,y-1);yy<=Math.min(h-1,y+1);yy++)for(let xx=Math.max(0,x-1);xx<=Math.min(w-1,x+1);xx++){const n=yy*w+xx;if(clean[n]&&!seen[n]){seen[n]=1;queue[tail++]=n;}}
  }
  if(tail<w*h*.002){for(let k=0;k<tail;k++)values[queue[k]!]=0;continue;}
  regions.push({rect:{x:(x0+l)/width,y:(y0+t)/height,w:(r-l+1)/width,h:(bt-t+1)/height},meanScore:total/tail,area:tail});
 }
 regions.sort((a,b)=>b.area-a.area);
 // Red is limited to accepted changed components, never low-level global residuals.
 for(let i=0;i<values.length;i++)if(!clean[i])values[i]=0;
 const overlapRect={x:x0/width,y:y0/height,w:w/width,h:h/height};
 const overlays:Overlay[]=[{type:'raster',width:w,height:h,values:Array.from(values),rect:{x:overlapRect.x,y:overlapRect.y,width:overlapRect.w,height:overlapRect.h},label:'Aligned difference; outside this crop was not compared'},...regions.map(r=>({type:'box' as const,x:r.rect.x,y:r.rect.y,width:r.rect.w,height:r.rect.h,label:'Strong difference'}))];
 return {...base,reason:'A difference map shows where pixels changed after alignment; it does not say who changed them or why.',
 observation:`${regions.length} area${regions.length===1?'':'s'} differ strongly from the original${regions[0]?` (largest near the ${direction(regions[0].rect)})`:''}. Areas outside the overlap were not compared.`,
 evidence:{alignment,overlapRect,regions,workingSize:{width,height},timingsMs:{alignment:alignMs,warpBlur:warpBlurMs,differenceRegions:performance.now()-diffStart,total:performance.now()-start}},overlays};
}
