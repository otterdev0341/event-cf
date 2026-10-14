import type { IncomingMessage, ServerResponse } from 'node:http';
export function handleGeneralEventTool(req: IncomingMessage & { body?: unknown }, res: ServerResponse, env?: Record<string, string | undefined>): Promise<void>;
