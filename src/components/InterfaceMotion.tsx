import { useEffect } from 'react';

/** Progressive motion: content stays visible if animation is unavailable. */
export function InterfaceMotion() {
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const seen = new WeakSet<Element>();
    const running = new Set<Animation>();
    const selector = 'main > header, main > section, .campaign-card, .metric-card, .preview-card, .campaign-form-panel, .campaign-upload-panel, .wizard-summary-card, .feature-card, .auth-card, .result-detail, .voice-connection__review, .preview-empty';
    const observer = new IntersectionObserver(entries => {
      let index = 0;
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        if (preference.matches || entry.target.closest('[hidden]')) continue;
        const animation = entry.target.animate([
          { opacity: .35, transform: 'translateY(12px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ], { duration: 420, delay: Math.min(index++ * 45, 180), easing: 'cubic-bezier(.22,1,.36,1)' });
        running.add(animation);
        animation.finished.then(() => running.delete(animation)).catch(() => running.delete(animation));
      }
    }, { threshold: .04 });
    const scan = () => {
      document.querySelector('main')?.setAttribute('id', 'main-content');
      document.querySelectorAll(selector).forEach(element => {
        if (seen.has(element) || element.closest('[hidden]')) return;
        seen.add(element); observer.observe(element);
      });
    };
    let frame = 0;
    const changes = new MutationObserver(() => {
      cancelAnimationFrame(frame); frame = requestAnimationFrame(scan);
    });
    changes.observe(document.getElementById('root')!, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
    const reduce = () => { if (preference.matches) running.forEach(animation => animation.cancel()); };
    preference.addEventListener('change', reduce);
    scan();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); changes.disconnect(); preference.removeEventListener('change', reduce); running.forEach(animation => animation.cancel()); };
  }, []);
  useEffect(() => {
    // Sliding hover pill: a spring-moved ::before on button groups (see button-motion.css).
    const groups = '.app-nav, .primary-nav, .rd-segment, .rd-tabs, .rd-subnav, .auth-tabs, .pk-grid, .pk-col, .pk-sub, .result-view-switch, .schedule-frequency > div';
    const move = (event: PointerEvent) => {
      const group = (event.target as Element).closest<HTMLElement>(groups);
      const item = (event.target as Element).closest<HTMLElement>(groups.split(', ').flatMap(g => ['a', 'button', 'label'].map(t => `${g} > ${t}`)).join(', '));
      if (!group || !item || item.parentElement !== group || (item as HTMLButtonElement).disabled) return;
      group.style.setProperty('--sl-x', `${item.offsetLeft}px`);
      group.style.setProperty('--sl-y', `${item.offsetTop}px`);
      group.style.setProperty('--sl-w', `${item.offsetWidth}px`);
      group.style.setProperty('--sl-h', `${item.offsetHeight}px`);
      if (group.dataset.slide !== 'on') { void group.offsetWidth; group.dataset.slide = 'on'; } // reflow so the first hover fades in instead of sliding from 0,0
    };
    const leave = (event: PointerEvent) => {
      const group = event.target instanceof Element ? event.target.closest<HTMLElement>(groups) : null;
      if (group && !group.contains(event.relatedTarget as Node | null)) delete group.dataset.slide;
    };
    document.addEventListener('pointerover', move);
    document.addEventListener('pointerout', leave);
    return () => { document.removeEventListener('pointerover', move); document.removeEventListener('pointerout', leave); };
  }, []);
  return <a className="skip-to-content" href="#main-content">ข้ามไปเนื้อหา</a>;
}
