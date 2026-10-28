interface CampaignStepIndicatorProps {
  activeStep?: number;
  transparent?: boolean;
}

const steps = ["ข้อมูลแคมเปญ", "เลือก Agent", "จับคู่ข้อมูล", "สรุปแคมเปญ"];

export function CampaignStepIndicator({
  activeStep = 1,
  transparent = false,
}: CampaignStepIndicatorProps) {
  return (
    <ol
      className={`campaign-steps${transparent ? " campaign-steps--transparent" : ""}`}
      aria-label="ขั้นตอนการสร้างแคมเปญ"
    >
      {steps.map((label, index) => {
        const step = index + 1;
        const isActive = step === activeStep;
        const isCompleted = step < activeStep;

        return (
          <li
            className={`campaign-steps__item${
              isActive ? " campaign-steps__item--active" : ""
            }${isCompleted ? " campaign-steps__item--completed" : ""}`}
            key={label}
            aria-current={isActive ? "step" : undefined}
          >
            <span className="campaign-steps__group">
              <span className="campaign-steps__number">
                {isCompleted ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg>
                ) : (
                  step
                )}
              </span>
              <span className="campaign-steps__text">
                <small>ขั้นตอน {step}</small>
                <span className="campaign-steps__label">{label}</span>
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
