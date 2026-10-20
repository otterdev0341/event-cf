import { Pagination, usePage } from '../../components/Pagination';
import { useState } from 'react';
import { Upload, Download } from 'lucide-react';
import { useEvent } from '../events';
import { useEventQuery } from '../../shared/api/useEventQuery';
import { usePermissions } from '../../shared/api/usePermissions';
import { participantService } from './service';
import { downloadTemplate } from './files';
import { ImportPanel } from './ImportPanel';
import { Badge, Button, Empty, Feedback, PageHeader, QueryState } from '../../components/ui';
export function ParticipantsPage() {
  const { event } = useEvent();
  const query = useEventQuery('participants', participantService.list);
  const { canEdit } = usePermissions();
  const [upload, setUpload] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<Error | null>(null);

  const rows = (query.data ?? []).filter((p) =>
    `${p.firstName} ${p.lastName} ${p.nickname} ${p.phone}`.includes(search),
  );
  const pagination = usePage(rows, search);
  if (!event) return <Empty title="เลือก Event เพื่อจัดการรายชื่อ" />;
  return (
    <>
      <PageHeader
        eyebrow={`${event.code} / PEOPLE`}
        title="People make the event."
        description="นำเข้ารายชื่อ ตรวจสอบข้อมูล แล้วเลือกเริ่มโทรเมื่อทีมพร้อม"
        action={
          canEdit && (
            <Button variant="brand" onClick={() => setUpload(true)}>
              <Upload size={16} />
              Upload participants
            </Button>
          )
        }
      />
      <div className="toolbar">
        <input
          aria-label="Search participants"
          placeholder="ค้นหาชื่อหรือเบอร์โทร…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Button onClick={() => void downloadTemplate(event, 'csv').catch(setError)}>
          <Download size={15} />
          CSV template
        </Button>
        <Button onClick={() => void downloadTemplate(event, 'xlsx').catch(setError)}>XLSX template</Button>
        <span className="eyebrow ml-auto">
          {event.code} / {event.date}
        </span>
      </div>
      <Feedback error={error} />
      <QueryState pending={query.isPending} error={query.error} retry={query.refetch} />
      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Participant</th>
              <th>Phone</th>
              <th>Queue</th>
              <th>Attendance</th>
            </tr>
          </thead>
          <tbody>
            {pagination.rows.map((p) => (
              <tr key={p.id}>
                <td>
                  {p.firstName} {p.lastName}
                  <p className="muted text-xs">
                    {p.nickname} · {p.lang_code}
                  </p>
                </td>
                <td className="font-mono text-xs">{p.phone}</td>
                <td>
                  <Badge>{p.lane}</Badge>
                </td>
                <td>
                  <Badge tone={p.outcome.result ?? ''}>{p.outcome.result ?? 'ยังไม่โทร'}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination {...pagination} />
        {!query.isPending && !rows?.length && (
          <Empty title="ยังไม่มีรายชื่อที่ตรงกับการค้นหา">
            ดาวน์โหลด template แล้วนำเข้าไฟล์ที่กรอกข้อมูลเรียบร้อย
          </Empty>
        )}
      </div>
      {upload && <ImportPanel event={event} onClose={() => setUpload(false)} />}
    </>
  );
}
