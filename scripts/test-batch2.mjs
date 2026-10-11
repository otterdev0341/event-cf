// Verification script for Batch 1.2 Telephony, Catalog, and Export
const BASE_URL = "https://api-voicebot-stg.botnoigroup.com";
const TOKEN = process.env.VOICE_BOT_ACCESS_TOKEN;
if (!TOKEN) throw new Error("Set VOICE_BOT_ACCESS_TOKEN to run live integration checks");
const TENANT_ID = "6a99319e7783bd7735035e42";

async function runTests() {
  console.log("=== BATCH 1.2 API VERIFICATION ===");
  const results = [];

  async function testEndpoint(name, fn) {
    const start = Date.now();
    try {
      const data = await fn();
      const elapsed = Date.now() - start;
      console.log(`✅ [PASS] ${name} (${elapsed}ms)`);
      results.push({ name, pass: true, elapsed, data });
      return data;
    } catch (err) {
      const elapsed = Date.now() - start;
      console.error(`❌ [FAIL] ${name} (${elapsed}ms):`, err.message);
      results.push({ name, pass: false, elapsed, error: err.message });
      return null;
    }
  }

  // 1. GET /v1/provisioning/tenants/{tenant_id}
  await testEndpoint(`1. Telephony Config: GET /v1/provisioning/tenants/${TENANT_ID}`, async () => {
    const res = await fetch(`${BASE_URL}/v1/provisioning/tenants/${TENANT_ID}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const data = await res.json();
    if (!data.tenant_id) throw new Error("Missing tenant_id");
    return data;
  });

  // 2. GET /v1/provisioning/tenants/{tenant_id}/trunk/status
  await testEndpoint(`2. Trunk Status: GET /v1/provisioning/tenants/${TENANT_ID}/trunk/status`, async () => {
    const res = await fetch(`${BASE_URL}/v1/provisioning/tenants/${TENANT_ID}/trunk/status`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const data = await res.json();
    if (data.registration?.state !== "registered") {
      console.warn("   Trunk state:", data.registration?.state);
    }
    return data;
  });

  // 3. GET /v1/provisioning/tenants/{tenant_id}/overview
  await testEndpoint(`3. Provisioning Overview: GET /v1/provisioning/tenants/${TENANT_ID}/overview`, async () => {
    const res = await fetch(`${BASE_URL}/v1/provisioning/tenants/${TENANT_ID}/overview`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const data = await res.json();
    if (!data.sections?.tenant || !data.sections?.trunk_status || !data.sections?.usage) {
      throw new Error("Missing overview sections");
    }
    return data;
  });

  // 4. GET /info/asr_providers
  await testEndpoint("4. ASR Providers: GET /info/asr_providers", async () => {
    const res = await fetch(`${BASE_URL}/info/asr_providers`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) throw new Error("No ASR providers returned");
    return data;
  });

  // 5. GET /info/get_tts_providers
  await testEndpoint("5. TTS Providers: GET /info/get_tts_providers", async () => {
    const res = await fetch(`${BASE_URL}/info/get_tts_providers`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) throw new Error("No TTS providers returned");
    return data;
  });

  // 6. Find a log file for export
  let sampleFileKey = "";
  await testEndpoint("6. Retrieve File for Export: GET /logs/list_file/", async () => {
    const res = await fetch(`${BASE_URL}/logs/list_file/?agent_id=agt_84e0236de877&start_date=2026/10/01&end_date=2026/10/07`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      sampleFileKey = data[0];
    }
    return data;
  });

  // 7. POST /logs/log/export (CSV)
  if (sampleFileKey) {
    await testEndpoint(`7. Export CSV: POST /logs/log/export`, async () => {
      const res = await fetch(`${BASE_URL}/logs/log/export`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ file_keys: [sampleFileKey] }),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const text = await res.text();
      if (!text.includes("File Name")) throw new Error("Invalid CSV format");
      return text;
    });

    // 8. POST /logs/log/export/pdf (PDF)
    await testEndpoint(`8. Export PDF: POST /logs/log/export/pdf`, async () => {
      const res = await fetch(`${BASE_URL}/logs/log/export/pdf`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ file_keys: [sampleFileKey] }),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const blob = await res.blob();
      if (blob.size === 0) throw new Error("Empty PDF blob");
      return { size: blob.size, type: blob.type };
    });
  }

  console.log("\n=== SUMMARY ===");
  const passed = results.filter((r) => r.pass).length;
  console.log(`Passed: ${passed}/${results.length}`);
}

runTests();
