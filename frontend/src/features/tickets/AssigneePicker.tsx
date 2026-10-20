import { useMembers } from '../organizations';
import { QueryState } from '../../components/ui';
export function AssigneePicker({
  selected = [],
  disabled = false,
}: {
  selected?: string[];
  disabled?: boolean;
}) {
  const members = useMembers();
  return (
    <fieldset disabled={disabled} className="assignee-picker">
      <legend>Assignees · เลือกได้หลายคน</legend>
      <QueryState pending={members.isPending} error={members.error} retry={members.refetch} />
      {members.data
        ?.filter((m) => m.status === 'active')
        .map((m) => (
          <label key={m.id} className="check-row">
            <input type="checkbox" name="assigneeIds" value={m.id} defaultChecked={selected.includes(m.id)} />
            {m.email}
          </label>
        ))}
    </fieldset>
  );
}
