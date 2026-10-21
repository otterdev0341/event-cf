// Integration environment only. Records acceptance; never contacts a telephone provider.
import http from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { timingSafeEqual } from "node:crypto";
const directory = process.env.PROVIDER_JOURNAL ?? "/data";
const token = process.env.PROVIDER_TOKEN;
if (!token || token.length < 24)
  throw new Error("Explicit simulation token required");
await mkdir(directory, { recursive: true });
const authorized = (value) => {
  const actual = Buffer.from(value ?? "");
  const expected = Buffer.from(`Bearer ${token}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};
const uuid = /^[a-f0-9-]{36}$/;
http
  .createServer(async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.url === "/healthz") return send(200, { ok: true, simulated: true });
    if (!authorized(req.headers.authorization))
      return send(401, { message: "Unauthorized" });
    try {
      if (req.method === "POST" && req.url === "/calls") {
        let text = "";
        for await (const chunk of req) {
          text += chunk;
          if (text.length > 16384)
            return send(413, { message: "Request too large" });
        }
        const body = JSON.parse(text);
        if (
          !uuid.test(body.attempt_id) ||
          req.headers["idempotency-key"] !== body.attempt_id
        ) {
          return send(422, { message: "Attempt identity required" });
        }
        const result = {
          provider_id: `simulated-${body.attempt_id}`,
          simulated: true,
        };
        const file = `${directory}/${body.attempt_id}.json`;
        try {
          // Do not store participant PII in the simulation journal.
          await writeFile(file, JSON.stringify(result), {
            flag: "wx",
            mode: 0o600,
          });
        } catch (error) {
          if (error.code !== "EEXIST") throw error;
        }
        return send(200, JSON.parse(await readFile(file, "utf8")));
      }
      const recording = req.url?.match(
        /^\/recordings\/([a-f0-9-]{36})(\/audio)?$/,
      );
      if (req.method === "GET" && recording) {
        const attempt = recording[1];
        const call = JSON.parse(
          await readFile(`${directory}/${attempt}.json`, "utf8"),
        );
        const recordingId = `synthetic-${attempt}`;
        if (!recording[2])
          return send(200, {
            attempt_id: attempt,
            provider_id: call.provider_id,
            recording_id: recordingId,
            content_type: "audio/wav",
            simulated: true,
          });
        // One second of silent PCM, never a real person's recording.
        const wav = Buffer.alloc(44 + 16000);
        wav.write("RIFF", 0);
        wav.writeUInt32LE(wav.length - 8, 4);
        wav.write("WAVEfmt ", 8);
        wav.writeUInt32LE(16, 16);
        wav.writeUInt16LE(1, 20);
        wav.writeUInt16LE(1, 22);
        wav.writeUInt32LE(8000, 24);
        wav.writeUInt32LE(16000, 28);
        wav.writeUInt16LE(2, 32);
        wav.writeUInt16LE(16, 34);
        wav.write("data", 36);
        wav.writeUInt32LE(16000, 40);
        res.writeHead(200, {
          "Content-Type": "audio/wav",
          "Content-Length": wav.length,
          "X-Attempt-Id": attempt,
          "X-Provider-Id": call.provider_id,
          "X-Recording-Id": recordingId,
        });
        return res.end(wav);
      }
      const id = req.url?.split("/")[2];
      if (req.method === "GET" && req.url === `/calls/${id}` && uuid.test(id)) {
        return send(
          200,
          JSON.parse(await readFile(`${directory}/${id}.json`, "utf8")),
        );
      }
      send(404, { message: "Unknown operation" });
    } catch (error) {
      send(error.code === "ENOENT" ? 404 : 422, {
        message: "No accepted call or invalid request",
      });
    }
  })
  .listen(Number(process.env.PORT ?? 8080), "0.0.0.0");
