import * as account from "./account";
import * as agents from "./agents";
import * as outbound from "./outbound";
import * as logs from "./logs";
import * as dashboard from "./dashboard";
import * as telephony from "./telephony";
import * as did from "./did";
import * as catalog from "./catalog";
import * as exp from "./export";
import * as tools from "./tools";
import { botnoiFetch, botnoiFetchBlob, BotnoiApiError, getBotnoiConfig } from "./client";

export * from "./types";
export * from "./client";
export * from "./export";

export const botnoiApi = {
  // Client & Helpers
  fetch: botnoiFetch,
  fetchBlob: botnoiFetchBlob,
  getConfig: getBotnoiConfig,

  // Group 1: Account
  getAccount: account.getAccount,

  // Group 2: Agents
  listAgents: agents.listAgents,
  getAgent: agents.getAgent,
  createOrUpdateAgent: agents.createOrUpdateAgent,
  deleteAgent: agents.deleteAgent,

  // Group 3: Telephony & PBX
  getTelephonyConfig: telephony.getTelephonyConfig,
  updateTelephonyConfig: telephony.updateTelephonyConfig,
  deleteTelephonyConfig: telephony.deleteTelephonyConfig,
  getTrunkStatus: telephony.getTrunkStatus,
  updateTrunkPassword: telephony.updateTrunkPassword,
  getProvisioningOverview: telephony.getProvisioningOverview,
  enableTenant: telephony.enableTenant,
  disableTenant: telephony.disableTenant,

  // Group 4: DID Numbers
  assignDid: did.assignDid,
  bindDidToAgent: did.bindDidToAgent,
  detachDid: did.detachDid,
  resyncDids: did.resyncDids,

  // Group 5: Outbound Calls
  placeCall: outbound.placeCall,
  getCallStatus: outbound.getCallStatus,

  // Group 6: Conversation Logs
  listCallLogsPlatform: logs.listCallLogsPlatform,
  getCallLogPlatform: logs.getCallLogPlatform,
  parseConversationMessages: logs.parseConversationMessages,
  listLogFiles: logs.listLogFiles,
  readLog: logs.readLog,
  fetchAudioBlob: logs.fetchAudioBlob,

  // Group 7: Dashboard Overview
  getDashboardOverview: dashboard.getDashboardOverview,

  // Group 8: Voice Catalog
  getAsrProviders: catalog.getAsrProviders,
  getTtsProviders: catalog.getTtsProviders,

  // Group 9: Log Export
  exportLogsCsv: exp.exportLogsCsv,
  exportLogsPdf: exp.exportLogsPdf,
  downloadBlob: exp.downloadBlob,

  // Group 10: Platform Tools & Health
  listPlatformTools: tools.listPlatformTools,
  createPlatformTool: tools.createPlatformTool,
  updatePlatformTool: tools.updatePlatformTool,
  deletePlatformTool: tools.deletePlatformTool,
  checkHealth: tools.checkHealth,
  checkProvisioningHealth: tools.checkProvisioningHealth,
};
