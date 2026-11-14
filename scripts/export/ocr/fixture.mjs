import {createCanvas} from '@napi-rs/canvas';
export const planted=[{text:'221B BAKER ST',size:14,x:1400,y:1000},{text:'SMALL TEXT TEN',size:10,x:300,y:400},{text:'TWENTY PIXEL TEXT',size:20,x:1800,y:1500},{text:'ROTATED FIFTEEN',size:20,x:400,y:1600,angle:15},{text:'ROTATED TWENTY FIVE',size:20,x:1700,y:500,angle:25}];
export function drawFixture(ctx){ctx.fillStyle='white';ctx.fillRect(0,0,3000,2000);ctx.fillStyle='black';for(const p of planted){ctx.save();ctx.translate(p.x,p.y);ctx.rotate((p.angle??0)*Math.PI/180);ctx.font=`${p.size}px Arial`;ctx.fillText(p.text,0,0);ctx.restore();}}
export function fixture(){const c=createCanvas(3000,2000);const ctx=c.getContext('2d');drawFixture(ctx);return ctx.getImageData(0,0,3000,2000);}
