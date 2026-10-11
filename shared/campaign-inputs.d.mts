export type VariableBinding = { source: 'csv'; column: string } | { source: 'output' };
export interface CampaignInputData {
  csv: { headers: string[]; rows: string[][] };
  mapping: Record<string, string>;
  variableBindings?: Record<string, VariableBinding>;
}
export interface PreparedContact { index: number; destination: string; variables: Record<string,string>; errors: string[] }
export function promptVariables(agent: { agent_data?: { greeting_text?: string; system_instruction?: string } } | null): string[];
export function campaignBindings(campaign: CampaignInputData | null, variables: string[]): Record<string, VariableBinding>;
export function prepareCampaignRows(campaign: CampaignInputData | null, variables: string[]): { bindings: Record<string,VariableBinding>; rows: PreparedContact[]; errors: string[] };
