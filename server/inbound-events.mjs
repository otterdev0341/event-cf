const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function normalizeCaller(value) {
  if (typeof value !== 'string') return null;
  const number = value.trim().replace(/[\s().-]/g, '');
  const normalized = /^0\d{8,9}$/.test(number) ? '+66' + number.slice(1) : /^66\d{8,9}$/.test(number) ? '+' + number : number;
  return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : null;
}
const clipped = (value, max = 4000) => typeof value === 'string' ? value.slice(0, max) : '';
export function eventProjection(record, accountId) {
  const c = record.data;
  const info = c.inboundInfo;
  return { id: record.id, name: clipped(c.name, 120), event_date: clipped(c.eventDate, 30), event_time: clipped(c.eventTime, 20),
    enabled: Boolean(info?.enabled && info.accountId === accountId), location: clipped(info?.location, 500),
    details: clipped(info?.details), updated_at: record.updated_at,
    contact_count: Array.isArray(c.csv?.rows) ? c.csv.rows.length : 0 };
}
export function lookupEvents(records, accountId, callerNumber) {
  const caller = normalizeCaller(callerNumber);
  if (!caller) return { status: 'caller_unavailable', events: [] };
  const events = [];
  for (const record of records) {
    const c = record.data;
    if (!c?.inboundInfo?.enabled || c.inboundInfo.accountId !== accountId) continue;
    const columns = c.csv?.headers;
    const rows = c.csv?.rows;
    if (!Array.isArray(columns) || !Array.isArray(rows)) continue;
    const index = columns.findIndex(column => c.mapping?.[column] === 'phone');
    if (index < 0 || !rows.some(row => Array.isArray(row) && normalizeCaller(row[index]) === caller)) continue;
    const { enabled, contact_count, updated_at, ...event } = eventProjection(record, accountId);
    events.push(event);
  }
  return { status: events.length > 1 ? 'choose_event' : events.length ? 'matched' : 'no_match', events };
}

const readCampaigns = async (db, ownerId, fail) => {
  const records = [];
  for (let offset = 0; ; offset += 100) {
    if (offset >= 10000) fail(503, 'มีแคมเปญมากเกินกว่าจะค้นครบ กรุณาติดต่อผู้ดูแล');
    const result = await db.from('voice_campaigns').select('id,data,updated_at').eq('owner_id', ownerId).eq('state', 'saved').order('id').range(offset, offset + 99);
    if (result.error) fail(503, 'อ่านรายละเอียดงานไม่ได้ กรุณาลองใหม่');
    records.push(...result.data);
    if (result.data.length < 100) return records;
  }
};

export async function handleInboundEvents({ action, id, method, body, store, user, connection, upstream, fail, send }) {
  const account = await upstream('/me');
  if (account._id !== connection.account_id || connection.owner_id !== user.id) fail(403, 'บัญชี Voice Bot ไม่ตรงกับบัญชีที่เชื่อม');
  if (action === 'lookup') {
    if (!body || Object.keys(body).some(key => key !== 'call_id') || typeof body.call_id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(body.call_id)) fail(400, 'กรุณาเลือกรหัสสายเข้าจริง');
    const call = await upstream('/calls/' + body.call_id);
    if (call.id !== body.call_id || call.direction !== 'inbound') fail(404, 'ไม่พบสายเข้าในบัญชีที่เชื่อม');
    const matched = lookupEvents(await readCampaigns(store, user.id, fail), account._id, call.number);
    return send(200, { ...matched, call_id: call.id, caller_number: normalizeCaller(call.number), checked_at: new Date().toISOString() });
  }
  if (method === 'GET') {
    const records = await readCampaigns(store, user.id, fail);
    return send(200, { account_id: account._id, events: records.map(record => eventProjection(record, account._id)),
      automatic_lookup_ready: false,
      context_notice: 'ระบบค้นจากเบอร์ในสายจริงพร้อมแล้ว แต่ยังต้องให้ Voice Bot ส่ง Call ID ของสายปัจจุบันให้ Tool ระหว่างสนทนา จึงจะค้นอัตโนมัติได้' });
  }
  if (!uuid.test(id || '') || !body || Object.keys(body).some(key => !['account_id','enabled','location','details','expected_updated_at'].includes(key)) || body.account_id !== account._id || typeof body.enabled !== 'boolean' || typeof body.location !== 'string' || body.location.length > 500 || typeof body.details !== 'string' || body.details.length > 4000 || typeof body.expected_updated_at !== 'string') fail(400, 'รายละเอียดงานไม่ถูกต้อง');
  const { data: record, error } = await store.from('voice_campaigns').select('id,data,updated_at').eq('id', id).eq('owner_id', user.id).eq('state', 'saved').maybeSingle();
  if (error) fail(503, 'อ่านแคมเปญไม่ได้');
  if (!record) fail(404, 'ไม่พบแคมเปญที่บันทึกแล้วในบัญชีนี้');
  if (record.updated_at !== body.expected_updated_at) fail(409, 'แคมเปญถูกแก้ไขแล้ว กรุณารีเฟรชก่อนบันทึก');
  if (body.enabled && !body.details.trim()) fail(400, 'เพิ่มรายละเอียดที่บอทใช้ตอบก่อนเปิดใช้งาน');
  const data = { ...record.data, inboundInfo: { accountId: account._id, enabled: body.enabled, location: body.location.trim(), details: body.details.trim() } };
  const result = await store.from('voice_campaigns').update({ data, updated_at: new Date().toISOString() }).eq('id', id).eq('owner_id', user.id).eq('state', 'saved').eq('updated_at', record.updated_at).select('id,data,updated_at');
  if (result.error) fail(503, 'ยังยืนยันการบันทึกไม่ได้ กรุณารีเฟรชก่อนลองใหม่');
  if (result.data?.length !== 1) fail(409, 'ข้อมูลถูกแก้ไขพร้อมกัน กรุณารีเฟรชก่อนบันทึก');
  return send(200, eventProjection(result.data[0], account._id));
}

