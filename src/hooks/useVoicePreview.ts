import { useEffect, useRef, useState } from 'react';
import { BotnoiApiError, botnoiFetch } from '../services/botnoi/client';

export interface PreviewData { agentId: string; name: string; variables: Record<string, string>; outputs: string[] }
export interface PreviewMessage { id: string; role: 'assistant' | 'user'; text: string; at: number }
type Phase = 'ready' | 'connecting' | 'active' | 'ended' | 'error';
interface PreviewToken { ephemeral_token: string; websocket_url: string; input_variables: Record<string, unknown>; streaming_text: boolean }

export function useVoicePreview(data: PreviewData) {
  const [phase, setPhase] = useState<Phase>('ready');
  const [messages, setMessages] = useState<PreviewMessage[]>([]);
  const [error, setError] = useState('');
  const [errorKind, setErrorKind] = useState<'account' | 'service' | 'other'>('other');
  const [muted, setMuted] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const generation = useRef(0);
  const cleanup = useRef<() => void>(() => {});
  const isMuted = useRef(false);
  const running = useRef(false);
  useEffect(() => () => { generation.current++; cleanup.current(); }, []);
  function stop() { generation.current++; cleanup.current(); running.current = false; setSpeaking(false); setPhase('ended'); }
  function reset() { stop(); setMessages([]); setError(''); setErrorKind('other'); setPhase('ready'); }
  function toggleMute() { isMuted.current = !isMuted.current; setMuted(isMuted.current); }

  async function start() {
    if (running.current) return;
    cleanup.current();
    const run = ++generation.current;
    const current = () => generation.current === run;
    running.current = true;
    setPhase('connecting'); setError(''); setErrorKind('other'); setMessages([]); setMuted(false); setSpeaking(false); isMuted.current = false;
    const abort = new AbortController();
    let socket: WebSocket | undefined, stream: MediaStream | undefined, context: AudioContext | undefined;
    let processor: ScriptProcessorNode | undefined, source: MediaStreamAudioSourceNode | undefined, silent: GainNode | undefined;
    let ping: ReturnType<typeof setInterval> | undefined, timeout: ReturnType<typeof setTimeout> | undefined, playbackEnd: ReturnType<typeof setTimeout> | undefined;
    const sources = new Set<AudioBufferSourceNode>();
    let seq = 0, closed = false, rate = 16000, audioType = 'audio/L16', nextPlay = 0, playing = false;
    const session = crypto.randomUUID();
    const send = (type: string, parameters: Record<string, unknown> = {}) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ version: '2', type, seq: ++seq, id: session, parameters }));
    };
    const stopAudio = () => {
      clearTimeout(playbackEnd); sources.forEach(node => { node.onended = null; try { node.stop(); } catch { /* Already ended. */ } }); sources.clear(); nextPlay = 0; playing = false;
      if (current()) setSpeaking(false);
    };
    const dispose = () => {
      if (closed) return; closed = true;
      abort.abort(); clearInterval(ping); clearTimeout(timeout); stopAudio();
      if (processor) { processor.onaudioprocess = null; processor.disconnect(); }
      source?.disconnect(); silent?.disconnect(); stream?.getTracks().forEach(track => track.stop());
      if (context && context.state !== 'closed') void context.close().catch(() => {});
      if (socket) {
        socket.onmessage = null; socket.onopen = null; socket.onclose = null; socket.onerror = null;
        send('close', { reason: 'end' }); socket.close();
      }
    };
    cleanup.current = dispose;
    const fail = (message: string, kind: typeof errorKind = 'other') => { if (!current() || closed) return; dispose(); running.current = false; setPhase('error'); setError(message); setErrorKind(kind); };
    const append = (role: PreviewMessage['role'], text: string, merge = false, replace = false) => {
      if (!text || !current()) return;
      setMessages(previous => {
        const last = previous.at(-1);
        if ((merge || replace) && last?.role === role) return [...previous.slice(0, -1), { ...last, text: replace ? text : last.text + text }];
        return [...previous, { id: crypto.randomUUID(), role, text, at: Date.now() }];
      });
    };
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('กรุณาเปิดเว็บผ่าน HTTPS และใช้เบราว์เซอร์ที่รองรับไมโครโฟน');
      context = new AudioContext({ sampleRate: 16000 });
      await context.resume();
      const token = await botnoiFetch<PreviewToken>(`/workspace/agents/${data.agentId}/preview-token`, { method: 'POST', body: { variables: data.variables, outputs: data.outputs }, signal: abort.signal });
      if (!current() || closed) return;
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
      if (!current() || closed) { stream.getTracks().forEach(track => track.stop()); return; }
      socket = new WebSocket(`${token.websocket_url}?token=${encodeURIComponent(token.ephemeral_token)}`);
      socket.binaryType = 'arraybuffer';
      timeout = setTimeout(() => fail('เชื่อมต่อบอทนานเกินไป กรุณาเริ่มใหม่'), 25000);
      socket.onopen = () => {
        socket!.send(JSON.stringify({ version: '2', type: 'open', seq: ++seq, id: session, position: 'POST-ANSWER', parameters: { conversationId: `conv-web-${crypto.randomUUID()}`, media: [{ type: 'audio/L16', sampleRateHz: 16000, channels: ['external'] }], inputVariables: token.input_variables } }));
        ping = setInterval(() => send('ping'), 20000);
      };
      socket.onerror = () => fail('เชื่อมต่อเสียงไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่');
      socket.onclose = event => {
        if (!current() || closed) return;
        if (event.code !== 1000) { fail('การเชื่อมต่อขาดหาย หรือสิทธิ์ทดสอบหมดอายุ กรุณาเริ่มใหม่'); return; }
        dispose(); running.current = false; setPhase('ended');
      };
      socket.onmessage = event => {
        if (!current() || closed || !context) return;
        if (event.data instanceof ArrayBuffer) {
          const bytes = event.data as ArrayBuffer;
          const ulaw = /ulaw|mulaw/i.test(audioType);
          const size = ulaw ? bytes.byteLength : Math.floor(bytes.byteLength / 2);
          if (!size) return;
          const buffer = context.createBuffer(1, size, rate), floats = buffer.getChannelData(0), view = new DataView(bytes);
          for (let i = 0; i < size; i++) {
            if (ulaw) { const v = (~view.getUint8(i)) & 255; const sample = (((v & 15) << 3) + 132) << ((v >> 4) & 7); floats[i] = ((v & 128) ? 132 - sample : sample - 132) / 32768; }
            else floats[i] = view.getInt16(i * 2, true) / 32768;
          }
          clearTimeout(playbackEnd);
          if (!playing) { playing = true; send('playback_started'); setSpeaking(true); }
          const node = context.createBufferSource(); node.buffer = buffer; node.connect(context.destination); sources.add(node);
          nextPlay = Math.max(context.currentTime + .025, nextPlay); node.start(nextPlay); nextPlay += buffer.duration;
          node.onended = () => { sources.delete(node); node.disconnect(); if (!sources.size) playbackEnd = setTimeout(() => { if (!closed && current()) { playing = false; setSpeaking(false); send('playback_completed'); } }, 600); };
          return;
        }
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        if (message.type === 'opened') {
          clearTimeout(timeout);
          const media = message.parameters?.media?.[0];
          rate = Number(media?.sampleRateHz || media?.rate || 16000); audioType = String(media?.type || media?.format || 'audio/L16');
          if (![8000, 16000, 24000, 48000].includes(rate) || !/L16|pcm/i.test(audioType)) { fail('รูปแบบเสียงที่บอทส่งมายังไม่รองรับ กรุณาตั้งค่าเสียงเป็น PCM'); return; }
          if (processor) return;
          source = context.createMediaStreamSource(stream!); processor = context.createScriptProcessor(1024, 1, 1);
          silent = context.createGain(); silent.gain.value = 0; source.connect(processor); processor.connect(silent); silent.connect(context.destination);
          let pending: number[] = [], cursor = 0;
          processor.onaudioprocess = audio => {
            if (closed || !current() || socket?.readyState !== WebSocket.OPEN) return;
            if (socket.bufferedAmount > 256000) { fail('เครือข่ายส่งเสียงไม่ทัน กรุณาเริ่มใหม่'); return; }
            const input = audio.inputBuffer.getChannelData(0), ratio = context!.sampleRate / rate;
            for (; cursor < input.length; cursor += ratio) pending.push(isMuted.current ? 0 : input[Math.floor(cursor)]);
            cursor -= input.length;
            const frame = Math.round(rate * .02);
            while (pending.length >= frame) {
              const pcm = new ArrayBuffer(frame * 2), view = new DataView(pcm);
              for (let i = 0; i < frame; i++) { const sample = Math.max(-1, Math.min(1, pending[i])); view.setInt16(i * 2, sample < 0 ? sample * 32768 : sample * 32767, true); }
              socket.send(pcm); pending = pending.slice(frame);
            }
          };
          setPhase('active');
        } else if (message.type === 'event') {
          for (const entity of message.parameters?.entities || []) {
            const value = entity.data;
            if (entity.type === 'barge_in') stopAudio();
            if (entity.type === 'bot_turn_response' && typeof value?.output === 'string') append('assistant', value.output, token.streaming_text, value.truncated === true);
            if (entity.type === 'user_turn_response' && value?.is_final) { const text = value.transcript?.result?.text ?? value.transcript?.text; if (typeof text === 'string') append('user', text); }
          }
        } else if (message.type === 'closed' || message.type === 'disconnect') {
          if (message.type === 'disconnect' && message.parameters?.reason !== 'completed') { fail('บริการยุติการทดสอบ กรุณาตรวจสิทธิ์และโควตาในบัญชี Voice Bot แล้วลองใหม่'); return; }
          dispose(); running.current = false; setPhase('ended');
        }
      };
    } catch (caught) {
      const message = caught instanceof DOMException && caught.name === 'NotAllowedError' ? 'กรุณาอนุญาตไมโครโฟนในเบราว์เซอร์ แล้วกดเริ่มใหม่' : caught instanceof Error ? caught.message : 'เริ่มทดสอบไม่สำเร็จ';
      const kind = caught instanceof BotnoiApiError && [401, 428].includes(caught.status) ? 'account'
        : caught instanceof BotnoiApiError && (caught.data as { code?: string } | undefined)?.code === 'preview_not_configured' ? 'service' : 'other';
      fail(message, kind);
    }
  }
  return { phase, messages, error, errorKind, muted, speaking, start, stop, reset, toggleMute };
}
