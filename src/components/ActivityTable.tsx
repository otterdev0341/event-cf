import { StatusBadge } from "./StatusBadge";

export interface ActivityItem {
  id?: string;
  campaign: string;
  customer: string;
  date: string;
  duration: string;
  status: string;
  tone: "success" | "danger" | "neutral";
}

interface ActivityTableProps {
  items: ActivityItem[];
  customerLabel?: string;
  campaignLabel?: string;
}

export function ActivityTable({ items, customerLabel = "ชื่อลูกค้า", campaignLabel = "แคมเปญ" }: ActivityTableProps) {
  return (
    <div className="activity-table-wrap">
      <table className="activity-table">
        <colgroup>
          <col className="activity-table__customer" />
          <col className="activity-table__campaign" />
          <col className="activity-table__date" />
          <col className="activity-table__status" />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">{customerLabel}</th>
            <th scope="col">{campaignLabel}</th>
            <th scope="col">วันที่โทร</th>
            <th scope="col">สถานะ</th>
            <th scope="col">ระยะเวลา</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id || `${item.customer}-${item.date}`}>
              <td>{item.customer}</td>
              <td>{item.campaign}</td>
              <td>{item.date}</td>
              <td><StatusBadge tone={item.tone}>{item.status}</StatusBadge></td>
              <td>{item.duration}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
