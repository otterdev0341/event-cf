import { useConversationDetail } from '../hooks/useBotnoiData';
export function ConversationLog({ conversationId }: { conversationId?: string }) {
  const { messages, loading, error } = useConversationDetail(conversationId);
  if (!conversationId) return <p className="workspace-note">เลือกบันทึกเพื่ออ่านบทสนทนาจริง</p>;
  if (loading) return <p role="status">กำลังโหลดบทสนทนา…</p>;
  if (error) return <p className="workspace-alert" role="alert">{error}</p>;
  if (!messages.length) return <p className="workspace-note">บันทึกนี้ไม่มีข้อความบทสนทนา</p>;
  return <div className="real-transcript">{messages.map((message, index) => <article key={index}><strong>{message.role === 'assistant' ? 'Agent' : message.role === 'user' ? 'ผู้สนทนา' : 'ระบบ / ข้อมูลบันทึก'}</strong><p>{message.text}</p></article>)}</div>;
}
