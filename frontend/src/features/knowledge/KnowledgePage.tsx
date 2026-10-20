import { CategoryMaster } from './CategoryMaster';
import { KnowledgeTransfer } from './KnowledgeTransfer';
import { useState } from 'react';
import { Plus, Upload, Pencil, Trash2 } from 'lucide-react';
import { useEvent } from '../events';
import { useWorkspace } from '../../stores/workspace';
import { useEventQuery } from '../../shared/api/useEventQuery';
import { useAction } from '../../shared/api/query';
import { usePermissions } from '../../shared/api/usePermissions';
import { knowledgeService } from './service';
import type { Faq } from '../../shared/contracts/events';
import { Dialog } from '../../components/Dialog';
import { Badge, Button, Empty, Feedback, Field, formText, PageHeader, QueryState } from '../../components/ui';
export function KnowledgePage() {
  const { event } = useEvent();
  const { orgId, eventId } = useWorkspace();
  const { canEdit } = usePermissions();
  const query = useEventQuery('knowledge', knowledgeService.get);
  const [mode, setMode] = useState('draft');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [editing, setEditing] = useState<Faq | 'new' | null>(null);
  const keys = ['org', orgId, eventId];
  const save = useAction(async (input: { question: string; answer: string; category: string }) => {
    await knowledgeService.save(
      orgId,
      eventId,
      input,
      editing && editing !== 'new' ? editing.id : undefined,
      editing && editing !== 'new' ? editing.version : undefined,
    );
    setEditing(null);
  }, keys);
  const publish = useAction(() => knowledgeService.publish(orgId, eventId), keys);
  const remove = useAction((id: string) => knowledgeService.remove(orgId, eventId, id), keys);
  if (!event) return <Empty title="เลือกหรือสร้าง Event ก่อน">Knowledge แยกตาม Event และองค์กร</Empty>;
  const data = mode === 'draft' ? query.data?.draft : query.data?.published;
  const faqs = data?.filter(
    (f) =>
      `${f.question} ${f.answer}`.toLowerCase().includes(search.toLowerCase()) &&
      (category === 'all' || category === f.category),
  );
  return (
    <>
      <PageHeader
        eyebrow={`${event.code} / KNOWLEDGE`}
        title="Answers, before they ask."
        description={`${event.name} · หมวดหมู่และ FAQ เฉพาะ Event นี้ เผยแพร่เมื่อพร้อมให้ Agent ใช้`}
        action={
          canEdit && (
            <Button
              variant="brand"
              disabled={!query.data}
              onClick={() => {
                save.reset();
                setEditing('new');
              }}
            >
              <Plus size={16} />
              เพิ่มคำถาม
            </Button>
          )
        }
      />
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={mode === 'draft'} onClick={() => setMode('draft')}>
          Draft workspace
        </button>
        <button role="tab" aria-selected={mode === 'published'} onClick={() => setMode('published')}>
          Agent published preview
        </button>
        <button role="tab" aria-selected={mode === 'categories'} onClick={() => setMode('categories')}>
          หมวดหมู่
        </button>
        <button role="tab" aria-selected={mode === 'transfer'} onClick={() => setMode('transfer')}>
          Template / Import
        </button>
      </div>
      {mode === 'categories' ? (
        <CategoryMaster />
      ) : mode === 'transfer' ? (
        <KnowledgeTransfer />
      ) : (
        <>
          <div className="toolbar">
            <input
              aria-label="Search FAQ"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหาคำถามหรือคำตอบ…"
            />
            <select
              aria-label="FAQ category filter"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="all">ทุกหมวดหมู่</option>
              {query.data?.categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            {canEdit && (
              <>
                <Button
                  className="ml-auto"
                  pending={publish.isPending}
                  disabled={event.status === 'archived'}
                  onClick={() => {
                    if (window.confirm('เผยแพร่ FAQ draft ทั้งหมดแทน snapshot ที่ Agent ใช้อยู่?'))
                      publish.mutate();
                  }}
                >
                  <Upload size={15} />
                  Publish knowledge
                </Button>
              </>
            )}
          </div>
          <Feedback error={publish.error || remove.error} notice={publish.notice || save.notice} />
          {mode === 'published' && (
            <p className="notice">
              แสดง snapshot ที่เผยแพร่แล้ว การแก้ draft จะไม่เปลี่ยนคำตอบของ Agent จนกด Publish
            </p>
          )}
          <QueryState pending={query.isPending} error={query.error} retry={query.refetch} />
          <div className="panel">
            {faqs?.map((faq) => (
              <article key={faq.id} className="faq-item">
                <div className="flex justify-between items-center">
                  <Badge>{faq.category}</Badge>
                  {canEdit && mode === 'draft' && (
                    <div className="flex">
                      <Button
                        variant="ghost"
                        aria-label={`แก้ไข ${faq.question}`}
                        onClick={() => {
                          save.reset();
                          setEditing(faq);
                        }}
                      >
                        <Pencil size={15} />
                      </Button>
                      <Button
                        variant="ghost"
                        aria-label={`ลบ ${faq.question}`}
                        onClick={() => {
                          if (window.confirm('ลบ FAQ draft นี้? Published snapshot จะยังอยู่จนเผยแพร่ใหม่'))
                            remove.mutate(faq.id);
                        }}
                      >
                        <Trash2 size={15} />
                      </Button>
                    </div>
                  )}
                </div>
                <h3>{faq.question}</h3>
                <p className="muted">{faq.answer}</p>
              </article>
            ))}
            {!query.isPending && !faqs?.length && (
              <Empty title="ยังไม่มีคำถาม">เพิ่มคำถามที่ทีมพบบ่อย เพื่อให้ Agent ช่วยตอบได้</Empty>
            )}
          </div>
          {editing && (
            <Dialog title={editing === 'new' ? 'เพิ่มคำถาม' : 'แก้ไขคำถาม'} onClose={() => setEditing(null)}>
              <form
                className="form-grid"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = e.currentTarget;
                  save.mutate({
                    question: formText(f, 'question'),
                    answer: formText(f, 'answer'),
                    category: formText(f, 'category'),
                  });
                }}
              >
                <Field label="Question">
                  <input
                    name="question"
                    required
                    maxLength={500}
                    defaultValue={editing === 'new' ? '' : editing.question}
                    autoFocus
                  />
                </Field>
                <Field label="Answer">
                  <textarea
                    name="answer"
                    required
                    maxLength={5000}
                    defaultValue={editing === 'new' ? '' : editing.answer}
                  />
                </Field>
                <Field label="Category">
                  <select
                    name="category"
                    defaultValue={editing === 'new' ? query.data?.categories[0] : editing.category}
                  >
                    {query.data?.categories.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </Field>
                <Feedback error={save.error} />
                <Button type="submit" variant="brand" pending={save.isPending}>
                  บันทึก draft
                </Button>
              </form>
            </Dialog>
          )}
        </>
      )}
    </>
  );
}
