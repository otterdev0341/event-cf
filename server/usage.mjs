// Aggregate actual telephone Call rows, never the separate preview-session dashboard.
export async function handleUsage({ query, connection, upstream, fail, send }) {
  const start = query.get('start_at'), end = query.get('end_at');
  const source = query.get('source') || 'all';
  if (!start || !end || !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || Date.parse(start) >= Date.parse(end) || Date.parse(end) - Date.parse(start) > 32 * 86400000 || !['all', 'outbound', 'inbound'].includes(source)) fail(400, 'ช่วงเวลาหรือประเภทสายไม่ถูกต้อง');
  const account = await upstream('/me');
  if (account._id !== connection.account_id) fail(403, 'บัญชี Voice Bot ไม่ตรงกับบัญชีที่เชื่อม');
  const params = new URLSearchParams({ limit: '100', from: start, to: end });
  if (source !== 'all') params.set('direction', source);
  const calls = new Map(), cursors = new Set();
  for (let page = 0; ; page++) {
    if (page >= 50) fail(502, 'ประวัติมีจำนวนมากเกินกว่าจะโหลดครบ กรุณาเลือกช่วง 7 วัน');
    const result = await upstream(`/calls?${params}`);
    if (!Array.isArray(result.items)) fail(502, 'Voice Bot ส่งประวัติสายรูปแบบไม่ถูกต้อง');
    for (const call of result.items) {
      if (typeof call.id !== 'string' || !Number.isFinite(Date.parse(call.started_at))) fail(502, 'ประวัติสายจาก Voice Bot ขาดรหัสสายหรือเวลาโทร');
      const time = Date.parse(call.started_at);
      if (time >= Date.parse(start) && time <= Date.parse(end) && (source === 'all' || call.direction === source)) calls.set(call.id, call);
    }
    if (!result.next_cursor) break;
    if (typeof result.next_cursor !== 'string' || cursors.has(result.next_cursor)) fail(502, 'Voice Bot ส่งหน้าประวัติซ้ำ จึงยังสรุปยอดทั้งหมดไม่ได้');
    cursors.add(result.next_cursor); params.set('cursor', result.next_cursor);
  }
  const empty = () => ({ call_count: 0, completed: 0, failed: 0, other: 0, duration_seconds: 0, duration_count: 0 });
  const summary = empty(), buckets = new Map();
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' });
  const failed = new Set(['failed', 'busy', 'no-answer', 'cancelled', 'canceled', 'unreachable', 'rejected']);
  for (const call of calls.values()) {
    const date = day.format(new Date(call.started_at));
    if (!buckets.has(date)) buckets.set(date, { date, ...empty() });
    const state = call.status === 'completed' ? 'completed' : failed.has(call.status) ? 'failed' : 'other';
    for (const target of [summary, buckets.get(date)]) {
      target.call_count++; target[state]++;
      if (typeof call.duration_seconds === 'number' && Number.isFinite(call.duration_seconds) && call.duration_seconds >= 0) {
        target.duration_seconds += call.duration_seconds; target.duration_count++;
      }
    }
  }
  send(200, { window: { start_at: start, end_at: end, timezone: 'Asia/Bangkok' }, source, checked_at: new Date().toISOString(), summary, series: [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date)) });
}
