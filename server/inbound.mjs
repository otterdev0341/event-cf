import { createHash } from 'node:crypto';

const revision = (account, did, agent) => createHash('sha256').update(JSON.stringify([account, did, agent])).digest('hex');
const numberPattern = /^\+?[0-9]{3,20}$/;
const text = value => typeof value === 'string' ? value : null;

// Only return the fields the inbound workspace needs. Never expose trunk credentials.
function snapshot(raw, accountId, fail) {
  const tenantSection = raw?.sections?.tenant;
  const trunkSection = raw?.sections?.trunk_status;
  if (!tenantSection?.ok || !tenantSection.data) {
    return { configured: false, numbers: [], readiness: null, paused: false, trunk_state: null,
      notice: 'ยังอ่านการตั้งค่าโทรศัพท์ไม่ได้ เปิด Voice Bot เพื่อตรวจว่าบัญชีนี้มีระบบโทรศัพท์และเบอร์รับสายแล้ว' };
  }
  const tenant = tenantSection.data;
  if (tenant.tenant_id && tenant.tenant_id !== accountId) fail(502, 'ข้อมูลระบบโทรศัพท์ไม่ตรงกับบัญชีที่เชื่อม');
  if (!Array.isArray(tenant.dids) || tenant.dids.some(did => typeof did !== 'string' || !numberPattern.test(did))) {
    fail(502, 'รูปแบบรายการเบอร์จาก Voice Bot ยังไม่รองรับ กรุณาจัดการเบอร์ใน Voice Bot');
  }
  const bindings = tenant.did_agents;
  if (bindings != null && (typeof bindings !== 'object' || Array.isArray(bindings))) fail(502, 'รูปแบบการผูกเบอร์จาก Voice Bot ไม่ถูกต้อง');
  const trunk = trunkSection?.ok ? trunkSection.data : null;
  const numbers = [...new Set(tenant.dids)].map(did => {
    const binding = bindings?.[did];
    if (binding != null && typeof binding !== 'string') fail(502, 'รูปแบบ Agent ประจำเบอร์ยังไม่รองรับ');
    const agentId = binding || null;
    return { did, agent_id: agentId, revision: revision(accountId, did, agentId) };
  });
  return { configured: true, numbers,
    readiness: typeof tenant.readiness?.inbound?.ready === 'boolean' ? tenant.readiness.inbound.ready : null,
    paused: Boolean(trunk?.disabled_at), trunk_state: text(trunk?.registration?.state),
    notice: !trunk ? 'ยังอ่านสถานะระบบโทรศัพท์ไม่ได้ กรุณาตรวจใน Voice Bot' : null };
}

export async function handleInbound({ action, method, body, connection, user, upstream, fail, send }) {
  const account = await upstream('/me');
  if (account._id !== connection.account_id || !/^[a-zA-Z0-9_-]+$/.test(account._id)) fail(403, 'บัญชี Voice Bot ไม่ตรงกับบัญชีที่เชื่อม');
  const canManage = connection.owner_id === user.id && Boolean(user.email_confirmed_at);
  const root = `/v1/provisioning/tenants/${account._id}`;

  if (action === 'history') {
    // One bounded page; show that this is recent history, not an account-wide total.
    const result = await upstream('/calls?direction=inbound&limit=50');
    if (!Array.isArray(result?.items)) fail(502, 'รูปแบบประวัติสายเข้าจาก Voice Bot ไม่ถูกต้อง');
    const rows = new Map();
    for (const call of result.items) {
      if (call.direction !== 'inbound') continue;
      if (typeof call.id !== 'string') fail(502, 'ประวัติสายเข้าขาดรหัสสาย');
      rows.set(call.id, { id: call.id, started_at: text(call.started_at), status: text(call.status),
        number: text(call.number), phone_number: text(call.phone_number), agent_id: text(call.agent?.id), agent_name: text(call.agent?.name),
        duration_seconds: Number.isFinite(call.duration_seconds) && call.duration_seconds >= 0 ? call.duration_seconds : null });
    }
    return send(200, { account_id: account._id, items: [...rows.values()].sort((a,b) => (b.started_at || '').localeCompare(a.started_at || '')), has_more: Boolean(result.next_cursor), checked_at: new Date().toISOString() });
  }

  const read = async () => snapshot(await upstream(`${root}/overview?include=tenant,trunk_status`), account._id, fail);
  const state = await read();
  if (method === 'GET') return send(200, { ...state, account_id: account._id, can_manage: canManage, checked_at: new Date().toISOString() });
  if (!canManage) fail(403, 'เฉพาะเจ้าของบัญชีที่เชื่อมเท่านั้นที่เปลี่ยน Agent รับสายได้');
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['did','agent_id','revision','confirmed','account_id'].includes(key))) fail(400, 'ข้อมูลการผูกเบอร์ไม่ถูกต้อง');
  if (body.confirmed !== true || body.account_id !== account._id) fail(409, 'กรุณาตรวจและยืนยันบัญชี เบอร์ และ Agent อีกครั้ง');
  if (typeof body.did !== 'string' || !numberPattern.test(body.did) || typeof body.agent_id !== 'string' || !/^agt_[a-zA-Z0-9_-]+$/.test(body.agent_id)) fail(400, 'กรุณาเลือกเบอร์และ Agent ที่ถูกต้อง');
  const number = state.numbers.find(item => item.did === body.did);
  if (!number) fail(403, 'ไม่พบเบอร์นี้ในบัญชีที่เชื่อม');
  if (number.revision !== body.revision) fail(409, 'การผูกเบอร์เปลี่ยนไปแล้ว กรุณารีเฟรชแล้วตรวจอีกครั้ง');
  const agents = await upstream('/agents');
  if (!Array.isArray(agents) || !agents.some(agent => agent.agent_id === body.agent_id)) fail(403, 'Agent นี้ไม่อยู่ในบัญชีที่เชื่อม');
  if (number.agent_id !== body.agent_id) {
    try { await upstream(`${root}/dids/${encodeURIComponent(body.did)}`, { agent_id: body.agent_id }, 'PUT'); }
    catch { fail(502, 'ยังยืนยันการบันทึกไม่ได้ กรุณารีเฟรชตรวจ Agent ประจำเบอร์ก่อนบันทึกซ้ำ'); }
  }
  let latest;
  try { latest = await read(); }
  catch { fail(502, 'ส่งการผูกเบอร์แล้ว แต่ยังอ่านกลับไม่ได้ กรุณารีเฟรชก่อนบันทึกซ้ำ'); }
  if (latest.numbers.find(item => item.did === body.did)?.agent_id !== body.agent_id) fail(409, 'Voice Bot ยังไม่ยืนยัน Agent ที่เลือก กรุณารีเฟรชก่อนบันทึกซ้ำ');
  return send(200, { ...latest, account_id: account._id, can_manage: canManage, checked_at: new Date().toISOString() });
}
