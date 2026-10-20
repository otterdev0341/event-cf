import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useEvent } from './hooks';
import { callSeries } from './dashboard';
import { participantService } from '../participants';
import { callingService } from '../calling';
import { ticketService } from '../tickets';
import { knowledgeService } from '../knowledge';
import { useMembers } from '../organizations';
import { BarChart } from '../../components/BarChart';
import { useEventQuery } from '../../shared/api/useEventQuery';
import { Badge, Empty, PageHeader, QueryState } from '../../components/ui';
export function EventOverview() {
  const { event } = useEvent();
  const [period, setPeriod] = useState<'daily' | 'weekly'>('daily');
  const people = useEventQuery('participants', participantService.list);
  const tickets = useEventQuery('tickets', ticketService.list);
  const queue = useEventQuery('queue', callingService.get);
  const knowledge = useEventQuery('knowledge', knowledgeService.get);
  const members = useMembers();
  if (!event) return <Empty title="เลือก Event เพื่อดู Dashboard" />;
  const base = `/orgs/${event.orgId}/events/${event.id}`;
  const rows = people.data ?? [];
  const tasks = tickets.data ?? [];
  const series = callSeries(rows, period);
  const assigned = members.data?.filter((m) => m.status === 'active') ?? [];
  const actionable = rows.filter((p) => ['ready', 'delayed'].includes(p.state));
  const updated = [...(knowledge.data?.draft ?? [])]
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
    .slice(0, 5);
  const pending =
    people.isPending || tickets.isPending || queue.isPending || knowledge.isPending || members.isPending;
  const error = people.error || tickets.error || queue.error || knowledge.error || members.error;
  return (
    <>
      <PageHeader
        eyebrow={`${event.code} / EVENT DASHBOARD`}
        title={event.name}
        description={`${event.date} · ${event.location}`}
      />
      <QueryState
        pending={pending}
        error={error}
        retry={() => {
          void people.refetch();
          void tickets.refetch();
          void queue.refetch();
          void knowledge.refetch();
          void members.refetch();
        }}
      />
      {!pending && !error && (
        <>
          <div className="dashboard-stats">
            {[
              ['Calls made', rows.reduce((n, p) => n + p.attempts.length, 0)],
              ['Open tickets', tasks.filter((t) => t.status !== 'resolved').length],
              ['People left to call', actionable.length],
              ['Confirmed', rows.filter((p) => p.outcome.result === 'confirm').length],
            ].map(([label, value]) => (
              <div className="panel p-6" key={label}>
                <p className="eyebrow">{label}</p>
                <strong className="metric">{value}</strong>
              </div>
            ))}
          </div>
          <section className="panel p-6 mt-6">
            <div className="queue-heading">
              <h2>Outbound calls</h2>
              <div className="tabs" role="tablist" aria-label="Call chart period">
                {(['daily', 'weekly'] as const).map((value) => (
                  <button
                    key={value}
                    role="tab"
                    aria-selected={period === value}
                    onClick={() => setPeriod(value)}
                  >
                    {value === 'daily' ? 'Daily' : 'Weekly'}
                  </button>
                ))}
              </div>
            </div>
            <p className="muted text-xs mb-4">
              {period === 'daily' ? '7 วันล่าสุด' : '8 สัปดาห์ล่าสุด เริ่มวันจันทร์'} · Asia/Bangkok ·
              รวมสายแรกและสายโทรซ้ำ
            </p>
            <BarChart
              title="Outbound call attempts"
              labels={series.labels}
              series={[{ label: 'Calls', values: series.values, color: '#5578cf' }]}
            />
          </section>
          <div className="dashboard-grid mt-6">
            <section className="panel p-6">
              <h2>Team follow-up workload</h2>
              <p className="muted text-xs my-3">
                Ticket ที่มีหลายผู้รับผิดชอบนับให้ทุกคน จึงไม่ควรรวมเป็นยอด ticket ทั้งหมด
              </p>
              <BarChart
                title="Tickets by assignee"
                labels={assigned.map((m) => m.email.split('@')[0])}
                series={[
                  {
                    label: 'Open',
                    color: '#c19744',
                    values: assigned.map(
                      (m) =>
                        tasks.filter((t) => t.assigneeIds.includes(m.id) && t.status !== 'resolved').length,
                    ),
                  },
                  {
                    label: 'Closed',
                    color: '#34866b',
                    values: assigned.map(
                      (m) =>
                        tasks.filter((t) => t.assigneeIds.includes(m.id) && t.status === 'resolved').length,
                    ),
                  },
                ]}
              />
              <p className="muted text-xs mt-3">
                Unassigned: {tasks.filter((t) => !t.assigneeIds.length && t.status !== 'resolved').length}{' '}
                open tickets
              </p>
            </section>
            <section className="panel p-6">
              <h2>Queue remaining</h2>
              {[
                ['New calls', actionable.filter((p) => p.lane === 'new').length],
                ['Retry eligible / waiting', actionable.filter((p) => p.lane === 'fail').length],
                ['In flight / awaiting result', rows.filter((p) => p.state === 'awaiting_result').length],
                [
                  'Retry exhausted',
                  rows.filter((p) => p.state === 'stopped' && p.outcome.result === 'unknown').length,
                ],
              ].map(([label, count]) => (
                <div className="summary-row" key={label}>
                  <span>{label}</span>
                  <strong>{count}</strong>
                </div>
              ))}
              <div className="summary-row">
                <span>Queue status</span>
                <Badge>{queue.data?.status}</Badge>
              </div>
              <p className="muted text-xs mt-4">
                จำนวนคนที่เหลือ ไม่ใช่จำนวนครั้งโทรที่คาดการณ์ · ไม่รวมผู้ยืนยัน/ปฏิเสธและรายการที่หยุดแล้ว
              </p>
            </section>
          </div>
          <section className="panel p-6 mt-6">
            <h2>Recently updated FAQ</h2>
            <p className="muted text-xs my-3">
              Draft ล่าสุดของ Event นี้ · Agent เห็นเฉพาะ published snapshot
            </p>
            {updated.map((faq) => (
              <div className="summary-row gap-4" key={faq.id}>
                <div>
                  <Link className="event-link" to={`${base}/knowledge`}>
                    {faq.question}
                  </Link>
                  <p className="muted text-xs">{faq.category}</p>
                </div>
                <small>
                  {faq.updatedAt
                    ? new Date(faq.updatedAt).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })
                    : 'ไม่ระบุเวลา'}
                </small>
              </div>
            ))}
            {!updated.length && <p className="muted">ยังไม่มี FAQ</p>}
          </section>
        </>
      )}
    </>
  );
}
