export const terminalCall = status => ['completed','failed','busy','no-answer','cancelled','canceled'].includes(status);

// Submit sequentially; every accepted/uncertain attempt is recovered from durable history.
export async function runCampaignQueue({ rows, attempts, submit, readStatus, shouldStop, onUpdate, wait, now = Date.now, maxPolls = 120 }) {
  let lastSubmitted = Math.max(0, ...attempts.map(a => Date.parse(a.created_at) || 0));
  for (const row of rows) {
    if (shouldStop()) return 'paused';
    const previous = attempts.filter(a => a.metadata?.contact_row === row.index);
    if (previous.length > 1) throw new Error(`แถว ${row.index + 1} มีหลายคำขอ กรุณาตรวจประวัติก่อนดำเนินการต่อ`);
    let callId = previous[0]?.call_id;
    if (previous.length && !callId) throw new Error(`แถว ${row.index + 1} ยังยืนยันผลคำขอเดิมไม่ได้ หยุดคิวเพื่อป้องกันโทรซ้ำ`);
    if (!callId) {
      while (now() - lastSubmitted < 13000) {
        onUpdate(row.index, 'waiting', 'รอเว้นระยะส่งคำขอ');
        await wait(Math.min(1000, 13000 - (now() - lastSubmitted)));
        if (shouldStop()) return 'paused';
      }
      if (shouldStop()) return 'paused';
      onUpdate(row.index, 'submitting', 'กำลังส่งคำขอโทร');
      let result;
      try { result = await submit(row); }
      catch (error) { onUpdate(row.index, 'unknown', error.message); throw error; }
      callId = result.call_id;
      if (!callId) { onUpdate(row.index,'unknown','ไม่ได้รับ Call ID'); throw new Error(`แถว ${row.index + 1} ไม่ได้รับ Call ID กรุณาตรวจประวัติก่อนโทรซ้ำ`); }
      lastSubmitted = now();
      onUpdate(row.index, result.status || 'queued', 'บริการรับคำขอแล้ว', callId);
      if (result.persistence_warning) throw new Error(result.persistence_warning);
    }
    let terminal = false;
    for (let poll = 0; poll < maxPolls; poll++) {
      if (shouldStop()) return 'paused';
      const status = await readStatus(callId);
      onUpdate(row.index, status.status, status.reason || status.error || '', callId);
      if (terminalCall(status.status)) { terminal = true; break; }
      await wait(3000);
    }
    if (!terminal) throw new Error(`รอตรวจสถานะสายแถว ${row.index + 1} นานเกินไป หยุดคิวไว้ก่อน กดดำเนินการต่อเพื่อตรวจสายเดิม`);
  }
  return 'complete';
}
