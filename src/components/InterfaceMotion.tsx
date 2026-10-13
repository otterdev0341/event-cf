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
  return <a className="skip-to-content" href="#main-content">ข้ามไปเนื้อหา</a>;
}
