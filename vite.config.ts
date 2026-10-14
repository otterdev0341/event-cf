import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { handleResultCallback } from './server/callback.mjs';
import { handleVoice } from './server/voice.mjs';
import { handleGeneralEventTool } from './server/general-events.mjs';
import { handleRecordingCallback } from './server/recording-callback.mjs';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return { plugins: [react(), { name: 'voice-server', configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url?.split('?')[0] === '/api/voice') void handleVoice(req, res, env);
      else if (req.url?.split('?')[0] === '/api/voice-result') void handleResultCallback(req, res, env);
      else if (req.url?.split('?')[0] === '/api/voice-recording') void handleRecordingCallback(req, res, env);
      else if (req.url?.split('?')[0] === '/api/voice-events') void handleGeneralEventTool(req, res, env);
      else next();
    });
  } }], server: { host: '127.0.0.1' } };
});
