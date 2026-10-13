import { formatDialDestination } from "../../lib/campaigns";
import { botnoiFetch } from "./client";
import type { CallStatusResponse, OutboundCallResponse } from "./types";

export async function placeCall(
  tenantId: string,
  destination: string,
  agentId: string,
  context: { requestId: string; variables: Record<string, string>; campaignId?: string; contactRow?: number; campaignBatch?: boolean; campaignVersion?: string; redialOf?:string; previewTest?: boolean; outputs?: string[] },
): Promise<OutboundCallResponse> {
  return botnoiFetch<OutboundCallResponse>(
    `/v1/provisioning/tenants/${encodeURIComponent(tenantId)}/calls`,
    {
      method: "POST",
      body: {
        destination: formatDialDestination(destination),
        agent_id: agentId,
        consent: true,
        request_id: context.requestId,
        metadata: { variables: context.variables, ...(context.previewTest ? {preview_test:true, output_variables:context.outputs || []} : {}), ...(context.campaignBatch ? {campaign_batch:true, campaign_version:context.campaignVersion} : {}), ...(context.redialOf ? {campaign_redial_of:context.redialOf} : {}), ...(context.campaignId ? { campaign_id: context.campaignId } : {}), ...(context.contactRow !== undefined ? { contact_row: context.contactRow } : {}) },
      },
    },
  );
}

export async function getCallStatus(
  tenantId: string,
  callId: string,
): Promise<CallStatusResponse> {
  return botnoiFetch<CallStatusResponse>(
    `/v1/provisioning/tenants/${encodeURIComponent(tenantId)}/calls/${encodeURIComponent(callId)}`,
  );
}
