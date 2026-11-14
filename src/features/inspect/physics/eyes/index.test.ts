import {describe,it,expect} from 'vitest';
import {extractHighlights,eyeObservation,sideBySide} from './index';
import {validateCheckResult} from '../../../../contracts';
import type {Pixels} from '../../../clean/mask';
const left={x:0.1,y:0.2,w:0.3,h:0.5},right={x:0.6,y:0.2,w:0.3,h:0.5};
function image():Pixels {const p={width:200,height:100,data:new Uint8ClampedArray(200*100*4)};for(let y=0;y<p.height;y++)for(let x=0;x<p.width;x++){const i=(y*p.width+x)*4;const disc=(x-50)**2+(y-45)**2<20**2 || (x-150)**2+(y-45)**2<20**2;const v=disc?15:45;p.data[i]=v;p.data[i+1]=v;p.data[i+2]=v;p.data[i+3]=255;}return p;}
function dot(p:Pixels,x:number,y:number,size=3){for(let yy=y;yy<y+size;yy++)for(let xx=x;xx<x+size;xx++){const i=(yy*p.width+xx)*4;p.data[i]=255;p.data[i+1]=255;p.data[i+2]=255;}}
describe('eye observations',()=>{
 it('extracts planted white components at known crop positions',()=>{
  const p=image();dot(p,40,30);const h=extractHighlights(p);expect(h).toHaveLength(1);expect(h[0]!.centroid.x).toBeCloseTo(41.5/200,2);expect(h[0]!.centroid.y).toBeCloseTo(31.5/100,2);expect(h[0]!.area).toBe(9);expect(h[0]!.peakLuma).toBeCloseTo(255);});
 it('maps offset crop centroids back to normalized image coordinates and validates the result',()=>{
  const p=image();dot(p,30,30);dot(p,140,40);const r=eyeObservation(p,'asset',left,right);expect(r.finding).toBe('inconclusive');expect(validateCheckResult(r)).toEqual([]);
  const o=r.overlays.find(o=>o.type==='points');expect(o?.type).toBe('points');if(o?.type==='points'){expect(o.points[0]!.x).toBeCloseTo(31.5/200,5);expect(o.points[0]!.y).toBeCloseTo(31.5/100,5);}
  expect(r.overlays.filter(o=>o.type==='box')).toHaveLength(2);
  expect(JSON.stringify(r)).not.toMatch(/fake|real|authentic|manipulat|ai-generated/i);
 });
 it('reports no highlights as not applicable',()=>{const r=eyeObservation(image(),'asset',left,right);expect(r.finding).toBe('not_applicable');expect(r.reason).toBeTruthy();expect(validateCheckResult(r)).toEqual([]);});
 it('reports one eye only with counts1/0 as inconclusive',()=>{const p=image();dot(p,30,30);const r=eyeObservation(p,'asset',left,right);expect(r.finding).toBe('inconclusive');expect((r.evidence.left as {highlights:unknown[]}).highlights).toHaveLength(1);expect((r.evidence.right as {highlights:unknown[]}).highlights).toHaveLength(0);expect(r.observation).toContain('upper-left');});
 it('reports crops smaller than12px or outside bounds as not applicable',()=>{
  for(const rect of [{x:0,y:0,w:0.02,h:0.1},{x:-0.1,y:0,w:0.3,h:0.3},{x:0.9,y:0,w:0.3,h:0.3},{x:NaN,y:0,w:0.3,h:0.3}]){const r=eyeObservation(image(),'asset',rect,right);expect(r.finding).toBe('not_applicable');expect(validateCheckResult(r)).toEqual([]);}
 });
 it('uses8-connected components; drops isolated noise and large bright regions',()=>{
  const p=image();dot(p,10,10,1);dot(p,11,11,1);dot(p,50,50,1);expect(extractHighlights(p)).toHaveLength(1);
  const bright=image();bright.data.fill(255);expect(extractHighlights(bright)).toEqual([]);
 });
 it('keeps only the five largest components',()=>{const p=image();for(let i=0;i<7;i++)dot(p,10+i*20,20,2+i%3);const h=extractHighlights(p);expect(h).toHaveLength(5);expect(h.map(x=>x.area)).toEqual(h.map(x=>x.area).sort((a,b)=>b-a));});
 it('returns square previews and marker positions without modifying input',()=>{
  const p=image();dot(p,30,30);const saved=p.data.slice();const view=sideBySide(p,left,right,128);expect(view.left.pixels.width).toBe(128);expect(view.left.pixels.height).toBe(128);expect(view.left.markers[0]!.x).toBeCloseTo(((31.5-20)/60)*128,4);expect(p.data).toEqual(saved);
 });
 it('rejects malformed pixels and invalid preview size',()=>{expect(()=>extractHighlights({width:2,height:2,data:new Uint8ClampedArray(3)})).toThrow();expect(()=>sideBySide(image(),left,right,0)).toThrow();});
 it('does not detect hidden RGB behind transparent pixels',()=>{const p=image();dot(p,10,10);for(let y=10;y<13;y++)for(let x=10;x<13;x++)p.data[(y*p.width+x)*4+3]=0;expect(extractHighlights(p)).toEqual([]);});
});
