import { useState } from 'react';
import { Button, Badge, Empty, Field, Feedback, PageHeader } from './ui';
import { Dialog } from './Dialog';
export function Gallery() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <PageHeader
        eyebrow="DEVELOPMENT / COMPONENT STATES"
        title="Workspace primitives"
        description="Shared controls, semantic states and keyboard interactions"
      />
      <div className="toolbar">
        <Button>Neutral</Button>
        <Button variant="brand">Brand</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="danger">Danger</Button>
        <Button disabled>Disabled</Button>
        <Button pending>Pending</Button>
      </div>
      <div className="toolbar">
        {['confirm', 'decline', 'unknown', 'published'].map((state) => (
          <Badge key={state} tone={state}>
            {state}
          </Badge>
        ))}
      </div>
      <div className="form-pair">
        <Field label="Default field" hint="ข้อความภาษาไทย รองรับการตัดบรรทัด">
          <input />
        </Field>
        <Field label="Invalid field" error="กรุณาตรวจสอบข้อมูล">
          <input defaultValue="Invalid" />
        </Field>
      </div>
      <Feedback error={new Error('Example request error')} notice="Example success" />
      <Empty title="Empty state">No records yet</Empty>
      <Button onClick={() => setOpen(true)}>Open dialog</Button>
      {open && (
        <Dialog title="Keyboard dialog" onClose={() => setOpen(false)}>
          <Field label="Autofocus">
            <input autoFocus />
          </Field>
          <Button onClick={() => setOpen(false)}>Done</Button>
        </Dialog>
      )}
    </>
  );
}
