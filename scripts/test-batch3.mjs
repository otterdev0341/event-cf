// Verification script for Batch 1.3 Platform Tools, Health, and Simulator readiness
const BASE_URL = "https://api-voicebot-stg.botnoigroup.com";
const TOKEN = process.env.VOICE_BOT_ACCESS_TOKEN;
if (!TOKEN) throw new Error("Set VOICE_BOT_ACCESS_TOKEN to run live integration checks");

async function runTests() {
  console.log("=== BATCH 1.3 API VERIFICATION ===");
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

  // 1. GET /platform-config/tools
  await testEndpoint("1. Platform Tools: GET /platform-config/tools", async () => {
    const res = await fetch(`${BASE_URL}/platform-config/tools`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error("Expected array of tools");
    console.log("   Found tools:", data.map((t) => t.name).join(", "));
    return data;
  });

  // 2. GET /health
  await testEndpoint("2. Backend Health: GET /health", async () => {
    const res = await fetch(`${BASE_URL}/health`);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const data = await res.json();
    if (data.status !== "ok") throw new Error(`Unexpected health status: ${data.status}`);
    return data;
  });

  // 3. GET /v1/provisioning/healthz
  await testEndpoint("3. Provisioning Health: GET /v1/provisioning/healthz", async () => {
    const res = await fetch(`${BASE_URL}/v1/provisioning/healthz`);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const data = await res.json();
    if (data.status !== "ok") throw new Error(`Unexpected healthz status: ${data.status}`);
    return data;
  });

  console.log("\n=== SUMMARY ===");
  const passed = results.filter((r) => r.pass).length;
  console.log(`Passed: ${passed}/${results.length}`);
}

runTests();
