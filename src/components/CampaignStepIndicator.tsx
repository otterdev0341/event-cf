interface CampaignStepIndicatorProps {
  activeStep?: number;
  transparent?: boolean;
}

const steps = ["ตั้งค่าแคมเปญ", "เลือก Agent", "จับคู่ข้อมูล", "สรุปแคมเปญ"];

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
            {index > 0 ? (
              <img
                className="campaign-steps__line"
                src="/assets/create-campaign/step-line.svg"
                width="40"
                height="2"
                alt=""
                aria-hidden="true"
              />
            ) : null}
            <span className="campaign-steps__group">
              <span className="campaign-steps__number">
                {isCompleted ? (
                  <img src="/assets/data-mapping/check.svg" width="14" height="14" alt="" />
                ) : (
                  step
                )}
              </span>
              <span className="campaign-steps__label">{label}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
