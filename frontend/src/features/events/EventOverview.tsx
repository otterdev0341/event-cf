import { Link } from 'react-router-dom';
import { useEvent } from './hooks';
import { Badge, Empty, PageHeader } from '../../components/ui';
export function EventOverview() {
  const { event } = useEvent();
  if (!event) return <Empty title="ไม่พบ Event" />;
  const base = `/orgs/${event.orgId}/events/${event.id}`;
  return (
    <>
      <PageHeader
        eyebrow={`${event.code} / EVENT OVERVIEW`}
        title={event.name}
        description={event.description}
      />
      <section className="panel p-6">
        <Badge tone={event.status}>{event.status}</Badge>
        <h2 className="mt-4">{event.date}</h2>
        <p className="muted">{event.location} · Asia/Bangkok</p>
      </section>
      <nav className="grid gap-3 mt-6" aria-label="Event sections">
        {[
          ['knowledge', 'Knowledge & FAQ'],
          ['participants', 'Participants'],
          ['calls', 'Call queues'],
          ['tickets', 'Follow-up board'],
          ['settings/credentials', 'Agent credentials'],
        ].map(([path, title]) => (
          <Link className="panel panel-heading event-link" key={path} to={`${base}/${path}`}>
            {title} →
          </Link>
        ))}
      </nav>
    </>
  );
}
