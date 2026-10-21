import { useState } from 'react';
import { useEventQuery } from '../../shared/api/useEventQuery';
import { useAction } from '../../shared/api/query';
import { useWorkspace } from '../../stores/workspace';
import type { ScheduleRule, ScheduleDto } from '../../shared/contracts/schedules';
import { scheduleService } from './service';
export function useSchedules() {
  const { orgId, eventId } = useWorkspace();
  const query = useEventQuery('schedules', scheduleService.list);
  const [open, setOpen] = useState(false);
  const create = useAction(
    async ({ rule, key }: { rule: ScheduleRule; key: string }) => {
      await scheduleService.create(orgId, eventId, rule, key);
      setOpen(false);
    },
    ['org', orgId, eventId],
  );
  const cancel = useAction(
    (schedule: ScheduleDto) => scheduleService.cancel(orgId, eventId, schedule.id, schedule.version),
    ['org', orgId, eventId],
  );
  return { query, open, setOpen, create, cancel };
}
