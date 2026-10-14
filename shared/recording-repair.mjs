// Opt-in listening derivative for the verified PCM/packed mu-law recording issue.
// This is not a reconstruction of authoritative call timestamps or caller identity.
export function repairRecordingWav(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 44 || buffer.byteLength > 16 * 1024 * 1024) throw Error('รองรับการปรับเสียงของไฟล์ขนาดไม่เกิน 16 MB');
  const input = new DataView(buffer);
  const text = (offset,length) => String.fromCharCode(...new Uint8Array(buffer,offset,length));
  if (text(0,4) !== 'RIFF' || text(8,4) !== 'WAVE' || input.getUint32(4,true)+8 !== buffer.byteLength) throw Error('ไฟล์ WAV ไม่สมบูรณ์');
  let format, dataOffset, dataLength;
  for (let offset=12; offset+8<=buffer.byteLength;) {
    const name=text(offset,4), size=input.getUint32(offset+4,true);
    if (size>buffer.byteLength-offset-8) throw Error('ข้อมูลไฟล์เสียงไม่ครบ');
    if (name==='fmt ') {
      if (size<16 || format) throw Error('รูปแบบเสียงไม่รองรับ');
      format={code:input.getUint16(offset+8,true),channels:input.getUint16(offset+10,true),rate:input.getUint32(offset+12,true),align:input.getUint16(offset+20,true),bits:input.getUint16(offset+22,true)};
    }
    if (name==='data') { if (dataOffset!==undefined) throw Error('รูปแบบเสียงไม่รองรับ'); dataOffset=offset+8; dataLength=size; }
    offset+=8+size+(size%2);
  }
  if (!format || format.code!==1 || format.channels!==2 || format.rate!==8000 || format.bits!==16 || format.align!==4 || dataOffset===undefined || !dataLength || dataLength%4) throw Error('ไฟล์นี้ไม่ตรงกับรูปแบบเสียงซ่าที่รองรับการปรับ');
  const frames=dataLength/4, rate=8000, window=80, spans=[];
  let begin=null,last=null;
  for (let i=0;i<frames;i+=window) {
    let active=0;
    for (let j=i;j<Math.min(i+window,frames);j++) if (input.getUint8(dataOffset+j*4+2) || input.getUint8(dataOffset+j*4+3)) active++;
    if (active>3) { if (begin===null) begin=i; last=Math.min(i+window,frames); }
    else if (begin!==null && i-last>rate*0.5) { spans.push({start:begin,end:last}); begin=null; }
  }
  if (begin!==null) spans.push({start:begin,end:last});
  if (!spans.length) throw Error('ไม่พบช่วงเสียงที่ปรับได้');
  const total=frames+spans.reduce((sum,span)=>sum+span.end-span.start,0);
  const result=new ArrayBuffer(44+total*2), output=new DataView(result);
  const writeText=(offset,value)=>{ for (let i=0;i<value.length;i++) output.setUint8(offset+i,value.charCodeAt(i)); };
  writeText(0,'RIFF'); output.setUint32(4,result.byteLength-8,true); writeText(8,'WAVEfmt '); output.setUint32(16,16,true); output.setUint16(20,1,true); output.setUint16(22,1,true); output.setUint32(24,rate,true); output.setUint32(28,rate*2,true); output.setUint16(32,2,true); output.setUint16(34,16,true); writeText(36,'data'); output.setUint32(40,total*2,true);
  const mulaw=value=>{ const u=(~value)&255,mag=(((u&15)<<3)+132)<<((u>>4)&7); return u&128 ? 132-mag : mag-132; };
  let dest=0,spanIndex=0;
  const write=(left,right)=>output.setInt16(44+dest++*2,Math.max(-32768,Math.min(32767,Math.round(left+right*0.5))),true);
  for (let i=0;i<frames;i++) {
    while (spanIndex<spans.length && i>=spans[spanIndex].end) spanIndex++;
    const span=spans[spanIndex], expanded=span && i>=span.start && i<span.end;
    const left=input.getInt16(dataOffset+i*4,true), low=input.getUint8(dataOffset+i*4+2), high=input.getUint8(dataOffset+i*4+3), padding=low===0 && high===0;
    if (expanded) { write(left,padding?0:mulaw(low)); write(left,padding?0:mulaw(high)); }
    else write(left,0);
  }
  return {buffer:result,original_seconds:frames/rate,adjusted_seconds:total/rate,turns:spans.length};
}
