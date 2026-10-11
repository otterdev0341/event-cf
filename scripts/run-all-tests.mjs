if (process.env.ALLOW_LIVE_CALLS !== "1") throw new Error("This legacy suite can place real calls. Set ALLOW_LIVE_CALLS=1 only with explicit authorization.");
import { spawn } from "node:child_process";

const BASE_URL = "https://api-voicebot-stg.botnoigroup.com";
const TOKEN = process.env.VOICE_BOT_ACCESS_TOKEN;
if (!TOKEN) throw new Error("Set VOICE_BOT_ACCESS_TOKEN to run live integration checks");
const TENANT_ID = "6a99319e7783bd7735035e42";

const ROUTES = [
  "/",
  "/login",
  "/dashboard",
  "/live-agent",
  "/campaigns",
  "/campaigns/new",
  "/campaigns/data-mapping",
  "/campaigns/api-agent",
  "/campaigns/api-test",
  "/contacts",
  "/contacts/1",
  "/analytics",
  "/settings",
];

async function runAllTests() {
  console.log("=================================================");
  console.log("🧪 VOICE CONFIRM - COMPREHENSIVE PHASE 2 TEST SUITE");
  console.log("=================================================\n");

  let totalPassed = 0;
  let totalFailed = 0;

  async function test(suiteName, testName, fn) {
    const start = Date.now();
    try {
      await fn();
      const elapsed = Date.now() - start;
      console.log(`  ✅ [PASS] ${testName} (${elapsed}ms)`);
      totalPassed++;
    } catch (err) {
      const elapsed = Date.now() - start;
      console.error(`  ❌ [FAIL] ${testName} (${elapsed}ms):`, err.message);
      totalFailed++;
    }
  }

  // --- SUITE 1: Core Voice Bot APIs ---
  console.log("📦 SUITE 1: Core Voice Bot APIs");
  await test("Suite 1", "GET /me (Account Profile & Tenant ID)", async () => {
    const res = await fetch(`${BASE_URL}/me`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data._id) throw new Error("Missing _id");
  });

  await test("Suite 1", "GET /agents (Agent Directory)", async () => {
    const res = await fetch(`${BASE_URL}/agents`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) throw new Error("Empty agent list");
  });

  await test("Suite 1", "GET /agents/agt_927435fb9cf7 (Agent Details & Prompt)", async () => {
    const res = await fetch(`${BASE_URL}/agents/agt_927435fb9cf7`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.bot_name) throw new Error("Missing bot_name");
  });

  await test("Suite 1", "GET /dashboard/v1/overview (Call Analytics & Distribution)", async () => {
    const now = new Date();
    const endAt = now.toISOString();
    const startAt = new Date(now.getTime() - 7 * 86400000).toISOString();
    const res = await fetch(`${BASE_URL}/dashboard/v1/overview?start_at=${startAt}&end_at=${endAt}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  });

  let convId = "";
  await test("Suite 1", "GET /logs/call_logs_platform (Live Call History)", async () => {
    const res = await fetch(`${BASE_URL}/logs/call_logs_platform?agent_id=agt_927435fb9cf7&limit=5`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.items && data.items.length > 0) {
      convId = data.items[0].conversation_id;
    }
  });

  if (convId) {
    await test("Suite 1", "GET /logs/call_logs_platform/{id} (Conversation Turn-by-Turn Detail)", async () => {
      const res = await fetch(`${BASE_URL}/logs/call_logs_platform/${convId}`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    });
  }

  let sampleFilePath = "";
  await test("Suite 1", "GET /logs/list_file/ (Bangkok Trailing Slash Audio Logs)", async () => {
    const res = await fetch(`${BASE_URL}/logs/list_file/?agent_id=agt_84e0236de877&start_date=2026/10/01&end_date=2026/10/07`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      sampleFilePath = data[0];
    }
  });

  if (sampleFilePath) {
    await test("Suite 1", "GET /logs/read_log/ (Transcript File Content)", async () => {
      const res = await fetch(`${BASE_URL}/logs/read_log/?file_path=${encodeURIComponent(sampleFilePath)}`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    });

    await test("Suite 1", "GET /logs/audio_url (Audio Stream Binary WAV)", async () => {
      const res = await fetch(`${BASE_URL}/logs/audio_url?file_path=${encodeURIComponent(sampleFilePath)}`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    });
  }

  // --- SUITE 2: Telephony, Trunk & Export ---
  console.log("\n📞 SUITE 2: Telephony, Trunk, Voice Catalog & Export");
  await test("Suite 2", "GET /v1/provisioning/tenants/{id} (PBX Setup)", async () => {
    const res = await fetch(`${BASE_URL}/v1/provisioning/tenants/${TENANT_ID}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  });

  await test("Suite 2", "GET /v1/provisioning/tenants/{id}/trunk/status (SIP Reachability)", async () => {
    const res = await fetch(`${BASE_URL}/v1/provisioning/tenants/${TENANT_ID}/trunk/status`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.registration?.configured) throw new Error("Trunk not configured");
  });

  await test("Suite 2", "GET /v1/provisioning/tenants/{id}/overview (Consolidated Telephony)", async () => {
    const res = await fetch(`${BASE_URL}/v1/provisioning/tenants/${TENANT_ID}/overview`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  });

  await test("Suite 2", "GET /info/asr_providers (Speech Recognition Providers)", async () => {
    const res = await fetch(`${BASE_URL}/info/asr_providers`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  });

  await test("Suite 2", "GET /info/get_tts_providers (Thai TTS Voice Catalog)", async () => {
    const res = await fetch(`${BASE_URL}/info/get_tts_providers`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  });

  await test("Suite 2", "POST /logs/log/export (CSV Report Generation)", async () => {
    const res = await fetch(`${BASE_URL}/logs/log/export`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ file_keys: ["agt_84e0236de877/2026-10-07_09-57-00_87b5787d-059e-4f80-8d4d-c2fa1c2821fa_0.txt"] }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (!text.includes("File Name")) throw new Error("Invalid CSV output");
  });

  await test("Suite 2", "POST /logs/log/export/pdf (PDF Report Binary)", async () => {
    const res = await fetch(`${BASE_URL}/logs/log/export/pdf`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ file_keys: ["agt_84e0236de877/2026-10-07_09-57-00_87b5787d-059e-4f80-8d4d-c2fa1c2821fa_0.txt"] }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    if (blob.size === 0) throw new Error("Empty PDF output");
  });

  let testCallId = "";
  await test("Suite 2", "POST /v1/provisioning/tenants/{id}/calls (Place Outbound Call)", async () => {
    const res = await fetch(`${BASE_URL}/v1/provisioning/tenants/${TENANT_ID}/calls`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ destination: "0812345678", agent_id: "agt_927435fb9cf7" }),
    });
    if (res.status !== 200 && res.status !== 202) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    testCallId = data.call_id;
    if (!testCallId) throw new Error("Missing call_id");
  });

  if (testCallId) {
    await test("Suite 2", "GET /v1/provisioning/tenants/{id}/calls/{callId} (Call Status Detection)", async () => {
      const res = await fetch(`${BASE_URL}/v1/provisioning/tenants/${TENANT_ID}/calls/${testCallId}`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.status) throw new Error("Missing call status");
    });
  }

  // --- SUITE 3: Tools & Health ---
  console.log("\n🛠️ SUITE 3: Platform Tools & Health Checks");
  await test("Suite 3", "GET /platform-config/tools (Custom Platform Tools)", async () => {
    const res = await fetch(`${BASE_URL}/platform-config/tools`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  });

  await test("Suite 3", "GET /health (API Gateway Health Check)", async () => {
    const res = await fetch(`${BASE_URL}/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.status !== "ok") throw new Error("Unhealthy");
  });

  await test("Suite 3", "GET /v1/provisioning/healthz (Telephony Engine Health Check)", async () => {
    const res = await fetch(`${BASE_URL}/v1/provisioning/healthz`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.status !== "ok") throw new Error("Unhealthy");
  });

  // --- SUITE 4: Local SPA Routes ---
  console.log("\n🌐 SUITE 4: Local Client Routes Availability (13 Pages)");
  for (const route of ROUTES) {
    await test("Suite 4", `Route: http://localhost:5173${route}`, async () => {
      const res = await fetch(`http://localhost:5173${route}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!text.includes("<!doctype html>") && !text.includes("<html")) {
        throw new Error("Invalid HTML response");
      }
    });
  }

  // --- SUMMARY ---
  console.log("\n=================================================");
  console.log("🏁 PHASE 2 TEST SUMMARY");
  console.log(`Passed: ${totalPassed}`);
  console.log(`Failed: ${totalFailed}`);
  console.log(`Total:  ${totalPassed + totalFailed}`);
  console.log("=================================================");

  if (totalFailed > 0) {
    process.exit(1);
  }
}

runAllTests();
