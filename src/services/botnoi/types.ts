export interface AccountProfile {
  _id: string;
  username: string;
  role: string;
  permissions: string[];
  email: string;
  verified: boolean;
}

export interface AgentListItem {
  name: string;
  agent_id: string;
}

export interface AgentDetail {
  _id: string;
  bot_name: string;
  agent_id: string;
  agent_data: {
    greeting_text: string;
    system_instruction: string;
    model?: string;
    gemini_live_model?: string;
    gemini_voice_name?: string;
    select_agent?: string;
    engine_type?: string;
    llm_provider?: string;
  };
  voice_data?: {
    asrProvider?: string;
    ttsProvider?: string;
    speakerCode?: string;
    formatCode?: string;
    interruptible?: boolean;
    speed?: number;
  };
  created_at?: string;
  updated_at?: string;
}

export interface OutboundCallRequest {
  destination: string;
  agent_id: string;
}

export interface OutboundCallResponse {
  persistence_warning?: string;
  call_id: string;
  status?: string;
  destination?: string;
  agent_id?: string;
}

export interface CallStatusResponse {
  call_id: string;
  status: "queued" | "ringing" | "in-progress" | "completed" | "failed" | "busy" | "no-answer" | string;
  destination?: string;
  agent_id?: string;
  created_at?: string;
  duration_seconds?: number;
  error?: string;
  reason?: string;
  path?: "pbx" | "pstn";
  answered_at?: string | null;
  completed_at?: string | null;
}

export interface CallLogPlatformItem {
  conversation_id: string;
  bot_name: string;
  agent_id: string;
  display_name: string;
  ws_session_id?: string;
  started_at: string;
  ended_at: string;
  created_at: string;
  updated_at: string;
}

export interface CallLogPlatformDetail {
  conversation_id: string;
  bot_name: string;
  agent_id: string;
  display_name: string;
  ws_session_id?: string;
  started_at: string;
  ended_at: string;
  messages: string; // JSON string of Array<{ role: string; text: string }>
  created_at: string;
  updated_at: string;
}

export interface ParsedConversationMessage {
  role: "system" | "assistant" | "user";
  text: string;
}

export interface ReadLogResponse {
  key: string;
  text: string;
}

export interface DashboardSeriesItem {
  bucket_start: string;
  call_count: number;
  avg_call_duration_seconds: number;
  total_call_cost_usd: number;
  avg_call_cost_usd: number;
}

export interface DashboardDistributionItem {
  key: string;
  count: number;
}

export interface DashboardOverviewResponse {
  window: {
    start_at: string;
    end_at: string;
    granularity: string;
    timezone: string;
  };
  currency: string;
  agents: Array<{ agent_id: string; bot_name: string }>;
  summary: {
    total_calls: number;
    avg_call_duration_seconds: number;
    total_call_cost_usd: number;
    avg_call_cost_usd: number;
  };
  series: DashboardSeriesItem[];
  distributions: {
    source: DashboardDistributionItem[];
    outcome: DashboardDistributionItem[];
    status: DashboardDistributionItem[];
  };
}

export interface TelephonyPbxConfig {
  mode?: string;
  transport?: string;
  address?: string;
  source_ips?: string[];
  dispatcher_set?: number;
  transfer_target_patterns?: string[];
  auth?: {
    username?: string;
    registrar?: string;
    expires?: number;
    auth_username?: string;
    password_ref?: string;
  };
}

export interface TelephonyOutboundConfig {
  enabled: boolean;
  caller_id?: {
    pbx?: string;
    pstn?: string;
  };
  default_path?: string;
}

export interface TelephonyConfig {
  tenant_id: string;
  bot?: Record<string, unknown>;
  pbx?: TelephonyPbxConfig;
  transfer_targets?: Record<string, unknown>;
  outbound?: TelephonyOutboundConfig;
  inbound?: Record<string, unknown>;
  dids?: string[];
  did_agents?: Record<string, string>;
  created_at?: string;
  updated_at?: string;
  readiness?: {
    pbx?: {
      ready: boolean;
      blockers?: string[];
      warnings?: Array<{ code: string; detail: string }>;
    };
    inbound?: {
      ready: boolean;
      blockers?: string[];
      warnings?: Array<{ code: string; detail: string }>;
    };
  };
}

export interface TrunkStatus {
  tenant_id: string;
  mode: string;
  disabled_at: string | null;
  reachability?: {
    dispatcher_set?: number;
    set_found?: boolean;
    targets?: Array<{
      uri: string;
      flags: string;
      state: "up" | "down" | string;
      priority: number;
    }>;
  };
  registration?: {
    configured: boolean;
    state: "registered" | "unregistered" | "failed" | string;
    record?: {
      l_uuid?: string;
      l_username?: string;
      l_domain?: string;
      r_username?: string;
      r_domain?: string;
      auth_username?: string;
      auth_proxy?: string;
      expires?: number;
      diff_expires?: number;
      timer_expires?: number;
      contact_addr?: string;
    };
  };
}

export interface TenantUsageSection {
  tenant_id: string;
  month: string;
  outbound?: {
    calls_total: number;
    calls_answered: number;
    calls_failed: number;
    answered_seconds: number;
  };
  inbound?: {
    sessions_answered: number;
    answered_seconds: number;
  };
  bot_minutes: number;
  transfers?: {
    success: number;
    failed: number;
  };
}

export interface TenantOverviewResponse {
  tenant_id: string;
  sections: {
    tenant: {
      ok: boolean;
      data: TelephonyConfig;
    };
    trunk_status: {
      ok: boolean;
      data: TrunkStatus;
    };
    usage: {
      ok: boolean;
      data: TenantUsageSection;
    };
  };
}

export interface AsrProviderItem {
  provider_name: string;
  language_code: Record<string, string>;
  asrType?: string | null;
}

export interface TtsProviderItem {
  provider: string;
  languages: string[];
  speaker_id: string;
  speaker_name: string;
}

export interface LogExportRequest {
  file_keys: string[];
}

export interface PlatformToolItem {
  tool_id: string;
  name: string;
  description: string;
  tool_type: "http" | string;
  status: "active" | "inactive" | string;
  parameters: {
    type: string;
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
}


