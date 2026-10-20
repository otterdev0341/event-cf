import { useState } from 'react';
import { knowledgeService } from './service';
import { useEventQuery } from '../../shared/api/useEventQuery';
import { useWorkspace } from '../../stores/workspace';
import { usePermissions } from '../../shared/api/usePermissions';
import { useAction } from '../../shared/api/query';
import { Dialog } from '../../components/Dialog';
import { Button, Field, Feedback, QueryState, formText } from '../../components/ui';
export function CategoryMaster() {
  const { orgId, eventId } = useWorkspace();
  const { canEdit } = usePermissions();
  const query = useEventQuery('knowledge', knowledgeService.get);
  const [editing, setEditing] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const save = useAction(
    async (name: string) => {
      await knowledgeService.category(
        orgId,
        eventId,
        name,
        query.data!.categoryRevision,
        editing || undefined,
      );
      setEditing(null);
    },
    ['org', orgId, eventId],
  );
  const remove = useAction(
    (name: string) => knowledgeService.removeCategory(orgId, eventId, name, query.data!.categoryRevision),
    ['org', orgId, eventId],
  );
  return (
    <>
      <div className="toolbar">
        <input
          aria-label="Search categories"
          placeholder="ค้นหาหมวดหมู่…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {canEdit && (
          <Button
            disabled={!query.data}
            onClick={() => {
              save.reset();
              setEditing('');
            }}
          >
            เพิ่มหมวดหมู่
          </Button>
        )}
      </div>
      <p className="muted mb-4">
        Master data เฉพาะ Event นี้ · เปลี่ยนชื่อจะปรับ FAQ draft; published snapshot คงเดิมจนเผยแพร่ใหม่
      </p>
      <Feedback error={remove.error} notice={save.notice || remove.notice} />
      <QueryState pending={query.isPending} error={query.error} retry={query.refetch} />
      <div className="panel table-wrap">
        <table aria-label="Category master">
          <thead>
            <tr>
              <th>Category</th>
              <th>Draft FAQ</th>
              <th>Published FAQ</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {query.data?.categories
              .filter((c) => c.toLowerCase().includes(search.toLowerCase()))
              .map((name) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td>{query.data?.draft.filter((f) => f.category === name).length}</td>
                  <td>{query.data?.published.filter((f) => f.category === name).length}</td>
                  <td>
                    {canEdit && (
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          onClick={() => {
                            save.reset();
                            setEditing(name);
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          pending={remove.isPending}
                          onClick={() => {
                            if (window.confirm(`ลบหมวดหมู่ ${name}?`)) remove.mutate(name);
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {editing !== null && (
        <Dialog title={editing ? 'แก้ไขหมวดหมู่' : 'เพิ่มหมวดหมู่'} onClose={() => setEditing(null)}>
          <form
            className="form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(formText(e.currentTarget, 'name'));
            }}
          >
            <Field label="ชื่อหมวดหมู่">
              <input name="name" required maxLength={80} defaultValue={editing} autoFocus />
            </Field>
            <Feedback error={save.error} />
            <Button pending={save.isPending}>บันทึกหมวดหมู่</Button>
          </form>
        </Dialog>
      )}
    </>
  );
}
