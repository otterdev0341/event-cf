// Verification script for Batch 1.1 Core API integration
const BASE_URL = "https://api-voicebot-stg.botnoigroup.com";
const TOKEN = process.env.VOICE_BOT_ACCESS_TOKEN;
if (!TOKEN) throw new Error("Set VOICE_BOT_ACCESS_TOKEN to run live integration checks");

async function runTests() {
  console.log("=== BATCH 1.1 API VERIFICATION ===");
  const results = [];

  // Helper
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

  // 1. GET /me
  let tenantId = "";
  await testEndpoint("1. Account: GET /me", async () => {
    const res = await fetch(`${BASE_URL}/me`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const data = await res.json();
    tenantId = data._id;
    if (!tenantId) throw new Error("Missing _id");
    return data;
  });

  // 2. GET /agents
  let testAgentId = "agt_927435fb9cf7";
  await testEndpoint("2. Agents: GET /agents", async () => {
    const res = await fetch(`${BASE_URL}/agents`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) throw new Error("No agents returned");
    return data;
  });

  // 3. GET /agents/{id}
  await testEndpoint(`3. Agent Details: GET /agents/${testAgentId}`, async () => {
    const res = await fetch(`${BASE_URL}/agents/${testAgentId}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const data = await res.json();
    if (!data.bot_name) throw new Error("Missing bot_name");
    return data;
  });

  // 4. GET /dashboard/v1/overview
  await testEndpoint("4. Dashboard: GET /dashboard/v1/overview", async () => {
    const startAt = "2026-10-01T00:00:00Z";
    const endAt = "2026-10-08T00:00:00Z";
    const res = await fetch(`${BASE_URL}/dashboard/v1/overview?start_at=${startAt}&end_at=${endAt}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.json();
  });

  // 5. GET /logs/call_logs_platform
  let testConvId = "";
  await testEndpoint("5. Call Logs Platform: GET /logs/call_logs_platform", async () => {
    const res = await fetch(`${BASE_URL}/logs/call_logs_platform?agent_id=${testAgentId}&limit=5`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const data = await res.json();
    if (data.items && data.items.length > 0) {
      testConvId = data.items[0].conversation_id;
    }
    return data;
  });

  // 6. GET /logs/call_logs_platform/{id}
  if (testConvId) {
    await testEndpoint(`6. Conversation Detail: GET /logs/call_logs_platform/${testConvId}`, async () => {
      const res = await fetch(`${BASE_URL}/logs/call_logs_platform/${testConvId}`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.json();
    });
  }

  // 7. GET /logs/list_file/
  let testFilePath = "";
  await testEndpoint("7. List Log Files: GET /logs/list_file/", async () => {
    const res = await fetch(`${BASE_URL}/logs/list_file/?agent_id=agt_84e0236de877&start_date=2026/10/01&end_date=2026/10/07`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      testFilePath = data[0];
    }
    return data;
  });

  // 8. GET /logs/read_log/
  if (testFilePath) {
    await testEndpoint(`8. Read Transcript: GET /logs/read_log/?file_path=${testFilePath}`, async () => {
      const res = await fetch(`${BASE_URL}/logs/read_log/?file_path=${encodeURIComponent(testFilePath)}`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.json();
    });
  }

  console.log("\n=== SUMMARY ===");
  const passed = results.filter((r) => r.pass).length;
  console.log(`Passed: ${passed}/${results.length}`);
}

runTests();
