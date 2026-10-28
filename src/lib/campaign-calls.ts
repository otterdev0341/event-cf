import { botnoiApi } from '../services/botnoi';
import { prepareCampaignRows, promptVariables } from '../../shared/campaign-inputs.mjs';
import type { CampaignDraft } from './campaigns';

// Re-reads the Agent and the telephone trunk right before a queue starts, so a run never
// uses a stale mapping or a trunk that went down since the page loaded.
export async function checkCampaignReady(campaign: CampaignDraft) {
  const agent = await botnoiApi.getAgent(campaign.agentId);
  const checked = prepareCampaignRows(campaign, promptVariables(agent));
  if (checked.errors.length) throw new Error('ตัวแปร Agent เปลี่ยนแล้ว กรุณากลับไปตรวจการจับคู่ CSV');
  const account = await botnoiApi.getAccount();
  const overview = await botnoiApi.getProvisioningOverview(account._id, { include: 'tenant,trunk_status' });
  const config = overview.sections.tenant, trunk = overview.sections.trunk_status;
  if (!config?.ok || !trunk?.ok || !config.data.outbound?.enabled || trunk.data.disabled_at || !config.data.readiness?.pbx?.ready || (trunk.data.mode !== 'ip' && trunk.data.registration?.state !== 'registered')) throw new Error('คู่สายโทรศัพท์ยังไม่พร้อม กรุณาตรวจการเชื่อมต่อ');
  return { account, checked };
}
