import type { IncomingMessage, ServerResponse } from 'node:http';
export function handleRecordingCallback(req: IncomingMessage, res: ServerResponse, env?: Record<string,string|undefined>): Promise<void>;
