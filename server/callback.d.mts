import type { IncomingMessage, ServerResponse } from 'node:http';
export function handleResultCallback(req: IncomingMessage, res: ServerResponse, env?: Record<string, string | undefined>): Promise<void>;
export function callbackConfigured(env: Record<string, string | undefined>): boolean;
