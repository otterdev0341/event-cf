import { Button } from "./Button";
import { ProgressBar } from "./ProgressBar";
import { StatusBadge } from "./StatusBadge";

export interface CampaignItem {
  actionLabel: string;
  name: string;
  progressLabel: string;
  progressValue: number;
  recipients: string;
  startTime: string;
  status: string;
  statusTone: "primary" | "success" | "neutral";
}

interface CampaignCardProps {
  campaign: CampaignItem;
}

export function CampaignCard({ campaign }: CampaignCardProps) {
  return (
    <article className="campaign-card">
      <header className="campaign-card__header">
        <div className="campaign-card__identity">
          <span className="campaign-card__icon" aria-hidden="true">
            <img src="/assets/campaigns/megaphone-off.svg" width="20" height="20" alt="" />
          </span>
          <h2>{campaign.name}</h2>
        </div>
        <StatusBadge size="campaign" tone={campaign.statusTone}>{campaign.status}</StatusBadge>
      </header>

      <div className="campaign-card__metrics">
        <div className="campaign-card__detail">
          <span>เวลาเริ่มแคมเปญ</span>
          <strong>{campaign.startTime}</strong>
        </div>
        <div className="campaign-card__detail">
          <span>ผู้รับสายทั้งหมด</span>
          <strong>{campaign.recipients}</strong>
        </div>
        <ProgressBar
          className="campaign-card__progress"
          label="ความสำเร็จ"
          value={campaign.progressValue}
          valueLabel={campaign.progressLabel}
        />
      </div>

      <div className="campaign-card__divider" aria-hidden="true">
        <img src="/assets/campaigns/divider.svg" width="1216" height="1" alt="" />
      </div>

      <footer className="campaign-card__footer">
        <div className="campaign-card__buttons">
          <Button className="campaign-action">
            <img src="/assets/campaigns/pause-circle.svg" width="14" height="14" alt="" />
            {campaign.actionLabel}
          </Button>
          <Button className="campaign-action campaign-action--secondary" variant="secondary">
            <img src="/assets/campaigns/users.svg" width="14" height="14" alt="" />
            รายชื่อ
          </Button>
          <Button className="campaign-action">ทดสอบ AGENT</Button>
          <Button className="campaign-action">
            <img src="/assets/campaigns/bar-chart.png" width="14" height="14" alt="" />
            รายงาน
          </Button>
        </div>
        <div className="campaign-card__text-actions">
          <button type="button">แก้ไขบทสนทนา</button>
          <button className="campaign-card__delete" type="button">ลบแคมเปญ</button>
        </div>
      </footer>
    </article>
  );
}
