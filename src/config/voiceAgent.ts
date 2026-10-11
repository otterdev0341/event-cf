export interface VoiceAgentConfig {
  id: string;
  name: string;
  description: string;
}

export const VOICE_AGENTS: Record<string, VoiceAgentConfig> = {
  wedding: {
    id: import.meta.env.VITE_AGENT_WEDDING_ID || "agt_927435fb9cf7",
    name: "wedding(VC)",
    description: "แคมเปญเชิญและยืนยันสิทธิ์เข้าร่วมงานแต่งงาน",
  },
  confirm: {
    id: import.meta.env.VITE_AGENT_CONFIRM_ID || "agt_d08edbb54933",
    name: "Confirm(VC)",
    description: "แคมเปญยืนยันนัดหมายและบริการทั่วไป",
  },
  eventConfirm: {
    id: import.meta.env.VITE_AGENT_EVENT_CONFIRM_ID || "agt_3a22d9cabd70",
    name: "EventConfirm(VC)",
    description: "แคมเปญยืนยันการเข้าร่วมอีเวนต์และสัมมนา (Event RSVP)",
  },
};
