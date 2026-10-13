export function promptVariables(agent) {
  const text = `${agent?.agent_data?.greeting_text || ''} ${agent?.agent_data?.system_instruction || ''}`;
  return [...new Set([...text.matchAll(/\{\{([a-zA-Z0-9_-]+)\}\}/g)].map(m => m[1]).filter(name => !['vc_call_reference', 'vc_record_conversation'].includes(name)))];
}

export function campaignBindings(campaign, variables) {
  const headers = campaign?.csv?.headers || [];
  const phone = headers.find(h => campaign?.mapping?.[h] === 'phone');
  return Object.fromEntries(variables.map(variable => {
    const saved = campaign?.variableBindings?.[variable];
    if (saved) return [variable, saved];
    const column = headers.find(h => campaign?.mapping?.[h] === variable)
      || (['phone_number', 'phone'].includes(variable) ? phone : undefined)
      || headers.find(h => h.trim().toLowerCase() === variable.toLowerCase()) || '';
    return [variable, { source: 'csv', column }];
  }));
}

// Each recipient gets an independent payload. No manual/global value fills a missing CSV cell.
export function prepareCampaignRows(campaign, variables) {
  const bindings = campaignBindings(campaign, variables);
  const headers = campaign?.csv?.headers || [];
  const phoneIndex = headers.findIndex(h => campaign?.mapping?.[h] === 'phone');
  const globalErrors = [];
  if (phoneIndex < 0) globalErrors.push('ยังไม่ได้เลือกคอลัมน์เบอร์โทร');
  if (variables.length > 50) globalErrors.push('รองรับตัวแปรไม่เกิน 50 ตัว');
  for (const variable of variables) {
    const binding = bindings[variable];
    if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(variable) || ['__proto__', 'constructor', 'prototype'].includes(variable)) globalErrors.push(`ชื่อตัวแปรไม่รองรับ: ${variable}`);
    if (binding.source !== 'output' && (binding.source !== 'csv' || !headers.includes(binding.column))) globalErrors.push(`เลือกคอลัมน์ CSV สำหรับ ${variable}`);
  }
  for (const old of Object.keys(campaign?.variableBindings || {})) {
    if (!variables.includes(old)) globalErrors.push(`Agent เปลี่ยนตัวแปรแล้ว กรุณาจับคู่ใหม่: ${old}`);
  }
  const rows = (campaign?.csv?.rows || []).map((row, index) => {
    const destination = (row[phoneIndex] || '').replace(/[\s().-]/g, '');
    const normalized = /^0\d{8,9}$/.test(destination) ? '+66' + destination.slice(1) : destination;
    const errors = [];
    if (!/^\+[1-9]\d{7,14}$/.test(normalized)) errors.push('เบอร์โทรไม่ถูกต้อง');
    const values = {};
    for (const variable of variables) {
      const binding = bindings[variable];
      if (binding.source !== 'csv' || !headers.includes(binding.column)) continue;
      const value = row[headers.indexOf(binding.column)] || '';
      if (!value.trim()) errors.push(`${variable} ว่าง`);
      else if (value.length > 2000) errors.push(`${variable} ยาวเกิน 2,000 ตัวอักษร`);
      else Object.defineProperty(values, variable, { value, enumerable: true });
    }
    if (new TextEncoder().encode(JSON.stringify(values)).length > 16000) errors.push('ข้อมูลของรายชื่อนี้ใหญ่เกินไป');
    return { index, destination, variables: values, errors };
  });
  if (!rows.length) globalErrors.push('ไม่มีรายชื่อใน CSV');
  return { bindings, rows, errors: globalErrors };
}
