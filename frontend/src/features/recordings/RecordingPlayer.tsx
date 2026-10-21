import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useWorkspace } from '../../stores/workspace';
import { Button, Feedback } from '../../components/ui';
import { recordingInfo } from './service';
export function RecordingPlayer({ attempt }: { attempt: string }) {
  const { orgId, eventId } = useWorkspace();
  const [requested, setRequested] = useState(false);
  const [failed, setFailed] = useState(false);
  const query = useQuery({
    queryKey: ['org', orgId, eventId, 'recording', attempt],
    enabled: requested && !__MOCK__,
    queryFn: ({ signal }) => recordingInfo(orgId, eventId, attempt, signal),
  });
  if (__MOCK__) return <p className="muted">Preview ไม่มีไฟล์เสียงจริง</p>;
  return (
    <div className="grid gap-2 mt-3">
      <Button
        pending={query.isFetching}
        onClick={() => {
          setFailed(false);
          if (requested) void query.refetch();
          else setRequested(true);
        }}
      >
        {requested ? 'ตรวจไฟล์เสียงอีกครั้ง' : 'ตรวจไฟล์เสียง'}
      </Button>
      <Feedback error={query.error} />
      {query.data?.state === 'pending' && <p>รอผลสุดท้ายของสายก่อนตรวจเสียง</p>}
      {query.data?.state === 'not_available' && (
        <p>ยังไม่มีไฟล์ที่ยืนยันว่าเป็นของสายนี้ ลองตรวจอีกครั้งภายหลัง</p>
      )}
      {query.data?.audioUrl && (
        <>
          {query.data.simulated && <p className="notice">เสียงสังเคราะห์สำหรับทดสอบ ไม่ใช่เสียงสนทนาจริง</p>}
          <audio
            key={query.dataUpdatedAt}
            controls
            preload="none"
            src={query.data.audioUrl}
            onError={() => setFailed(true)}
            aria-label="เสียงบันทึกการโทร"
          />
          <a href={query.data.audioUrl} download={`recording-${attempt}`} className="event-link">
            ดาวน์โหลดไฟล์เสียง
          </a>
          {failed && <p role="alert">โหลดเสียงไม่สำเร็จ กดตรวจไฟล์เสียงอีกครั้ง</p>}
        </>
      )}
    </div>
  );
}
