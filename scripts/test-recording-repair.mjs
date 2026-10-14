import assert from 'node:assert/strict';
import { repairRecordingWav } from '../shared/recording-repair.mjs';

globalThis.fetch=()=>assert.fail('Listening repair must not make a network request');
let passed=0;
function fixture() {
  const frames=16000,buffer=new ArrayBuffer(44+frames*4),v=new DataView(buffer);
  const text=(offset,s)=>{for(let i=0;i<s.length;i++)v.setUint8(offset+i,s.charCodeAt(i));};
  text(0,'RIFF');v.setUint32(4,buffer.byteLength-8,true);text(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,2,true);v.setUint32(24,8000,true);v.setUint32(28,32000,true);v.setUint16(32,4,true);v.setUint16(34,16,true);text(36,'data');v.setUint32(40,frames*4,true);
  for(const [start,end] of [[800,2400],[8000,9600]])for(let i=start;i<end;i++){v.setUint8(44+i*4+2,0x90);v.setUint8(44+i*4+3,0x92);}
  for(const [start,end] of [[4800,5600],[12800,13600]])for(let i=start;i<end;i++)v.setInt16(44+i*4,1000+(i%11),true);
  return buffer;
}
function test(name,fn){fn();passed++;console.log('PASS '+name);}
test('Listening derivative decodes each packed byte at 8 kHz and does not speed up speech',()=>{const result=repairRecordingWav(fixture());const v=new DataView(result.buffer);assert.equal(v.getUint32(24,true),8000);assert.equal(v.getUint16(22,true),1);assert.equal(v.getInt16(44+800*2,true),7998);assert.equal(result.original_seconds,2);assert.equal(result.adjusted_seconds,2.4);assert.equal(result.turns,2);});
test('Caller responses move after expanded bot turns and retain their samples and speed',()=>{const input=fixture(),output=repairRecordingWav(input).buffer,source=new DataView(input),target=new DataView(output);for(let i=4800;i<5600;i++)assert.equal(target.getInt16(44+(i+1600)*2,true),source.getInt16(44+i*4,true));for(let i=12800;i<13600;i++)assert.equal(target.getInt16(44+(i+3200)*2,true),source.getInt16(44+i*4,true));});
test('Pauses outside speech keep their original length',()=>{const v=new DataView(repairRecordingWav(fixture()).buffer);for(let i=4000;i<6400;i++)assert.equal(v.getInt16(44+i*2,true),0);});
test('Original buffer is never modified and repeated repair is deterministic',()=>{const source=fixture(),before=new Uint8Array(source).slice(),one=repairRecordingWav(source),two=repairRecordingWav(source);assert.deepEqual(new Uint8Array(source),before);assert.deepEqual(new Uint8Array(one.buffer),new Uint8Array(two.buffer));});
test('Output RIFF and data sizes agree with the longer waveform',()=>{const result=repairRecordingWav(fixture()),v=new DataView(result.buffer);assert.equal(v.getUint32(4,true)+8,result.buffer.byteLength);assert.equal(v.getUint32(40,true)+44,result.buffer.byteLength);assert.equal(v.getUint32(40,true)/2/8000,result.adjusted_seconds);});
test('Unsupported sample rates, mono files and compressed format are rejected',()=>{for(const [offset,value] of [[24,16000],[22,1],[20,7],[34,8],[32,2]]){const source=fixture(),v=new DataView(source);offset===24?v.setUint32(offset,value,true):v.setUint16(offset,value,true);assert.throws(()=>repairRecordingWav(source));}});
test('Malformed, truncated and non-WAV data are rejected',()=>{assert.throws(()=>repairRecordingWav(new ArrayBuffer(20)));const source=fixture();new DataView(source).setUint32(40,source.byteLength*2,true);assert.throws(()=>repairRecordingWav(source));assert.throws(()=>repairRecordingWav(fixture().slice(0,-4)));});
test('Large files and files without a repairable right channel fail explicitly',()=>{assert.throws(()=>repairRecordingWav(new ArrayBuffer(17*1024*1024)));const source=fixture(),v=new DataView(source);for(let i=44;i<source.byteLength;i+=4)v.setUint16(i+2,0,true);assert.throws(()=>repairRecordingWav(source),/ไม่พบช่วงเสียง/);});
console.log(`${passed} recording repair checks passed; synthetic audio only`);
