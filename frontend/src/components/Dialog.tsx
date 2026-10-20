import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from './ui';
export function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const dirty = useRef(false);
  const close = () => {
    if (!dirty.current || window.confirm('ละทิ้งข้อมูลที่ยังไม่ได้บันทึก?')) onClose();
  };
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const dialog = ref.current;
    dialog?.showModal();
    dialog
      ?.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled]), textarea:not([disabled])')
      ?.focus();
    return () => {
      dialog?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onChange={() => {
        dirty.current = true;
      }}
    >
      <div className="dialog-heading">
        <h2>{title}</h2>
        <Button variant="ghost" aria-label="ปิด" onClick={close}>
          <X size={18} />
        </Button>
      </div>
      {children}
    </dialog>
  );
}
