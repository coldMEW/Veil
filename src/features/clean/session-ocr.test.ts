import {describe,it,expect,vi} from 'vitest';
import {candidatesFromOcr,rescanExport} from './session';
const rect={x:0.1,y:0.2,w:0.3,h:0.1};
const quad=[{x:0.1,y:0.2},{x:0.4,y:0.25},{x:0.38,y:0.3},{x:0.08,y:0.25}];
describe('OCR Clean integration',()=>{
 it('preserves normalized quads and chooses glyph removal for OCR text',()=>{
  const [candidate]=candidatesFromOcr('asset',[{rect,quad,text:'221B BAKER ST'}]);
  expect(candidate?.quad).toEqual(quad);expect(candidate?.removal).toBe('glyph');
 });
 it('rescans decoded export pixels and compares selected regions',async()=>{
  const selected=candidatesFromOcr('asset',[{rect,quad,text:'221B BAKER ST'}]).map(c=>({...c,selected:true}));
  const pixels={width:2,height:2,data:new Uint8ClampedArray(16)};
  const engine={scan:vi.fn(async()=>[{rect,text:'STILL HERE'}])};
  const result=await rescanExport(engine,pixels,selected);
  expect(engine.scan).toHaveBeenCalledWith(pixels);
  expect(result).toEqual({stillDetected:[selected[0]!.id],totalBoxes:1});
 });
 it('propagates scan failures rather than claiming successful removal',async()=>{
  const engine={scan:vi.fn(async()=>{throw Error('OCR failed');})};
  await expect(rescanExport(engine,{width:1,height:1,data:new Uint8ClampedArray(4)},[])).rejects.toThrow('OCR failed');
 });
});
