import type { Session } from '../shared/contracts/identity';
import type { EventDto, Faq } from '../shared/contracts/events';
import type { Participant, Queue, ImportRow } from '../shared/contracts/calling';
import type { Ticket } from '../shared/contracts/tickets';
import type { Credential } from '../shared/contracts/credentials';
export const identity: Session = {
  user: { id: 'admin-preview', name: 'Admin', email: 'admin@otterheaven.com', platformRole: null },
  organizations: [
    { id: 'studio', name: 'Otter Studio', role: 'org_admin', eventIds: [] },
    { id: 'community', name: 'Community Lab', role: 'team_member', eventIds: ['community-day'] },
  ],
};
export const seedEvents: EventDto[] = [
  {
    id: 'design-2026',
    orgId: 'studio',
    name: 'Designing what comes next',
    code: 'DESIGN26',
    date: '2026-12-12',
    location: 'Bangkok · The Commons',
    description: 'พบปะ แลกเปลี่ยน และมองอนาคตของงานออกแบบไปด้วยกัน',
    status: 'published',
    version: 1,
    participantCount: 12,
  },
  {
    id: 'community-day',
    orgId: 'community',
    name: 'Community open day',
    code: 'COMM26',
    date: '2026-12-19',
    location: 'Chiang Mai',
    description: 'A day for new connections.',
    status: 'draft',
    version: 1,
    participantCount: 0,
  },
];
const faq: Faq = {
  id: 'faq-1',
  question: 'งานเริ่มกี่โมง และมีที่จอดรถไหม?',
  answer: 'ลงทะเบียนเวลา 09:00 น. มีที่จอดรถในอาคาร แจ้งชื่องานกับเจ้าหน้าที่ได้เลย',
  category: 'สถานที่และเวลา',
  version: 1,
  updatedAt: new Date().toISOString(),
};
const recipient = (id: string, firstName: string, lane: Participant['lane']): Participant => ({
  id,
  firstName,
  lastName: 'ตัวอย่าง',
  nickname: firstName,
  lang_code: 'th',
  phone: `+6680000000${id}`,
  lane,
  state: lane === 'done' ? 'stopped' : 'ready',
  noAnswerCount: lane === 'fail' ? 1 : 0,
  outcome:
    lane === 'fail'
      ? { result: 'unknown', reason: 'no_answer' }
      : lane === 'done'
        ? { result: 'confirm', reason: null }
        : { result: null, reason: null },
  attempts:
    lane === 'new'
      ? []
      : [
          {
            number: 1,
            transport: lane === 'fail' ? 'no_answer' : 'answered',
            outcome:
              lane === 'fail'
                ? { result: 'unknown', reason: 'no_answer' }
                : { result: 'confirm', reason: null },
            at: new Date(Date.now() - Number(id) * 86400000).toISOString(),
          },
        ],
});
export const state = {
  profile: structuredClone(identity),
  session: null as Session | null,
  events: structuredClone(seedEvents),
  knowledge: {
    'design-2026': {
      draft: [faq],
      published: [structuredClone(faq)],
      categories: ['สถานที่และเวลา', 'การเดินทาง'],
      categoryRevision: 1,
    },
  } as Record<string, { draft: Faq[]; published: Faq[]; categories: string[]; categoryRevision: number }>,
  participants: {
    'design-2026': [
      recipient('1', 'กานต์', 'new'),
      recipient('2', 'พิม', 'new'),
      recipient('3', 'นนท์', 'fail'),
      recipient('4', 'มีน', 'done'),
      ...[5, 12, 19, 26, 33, 40, 47, 54].map((id, index) =>
        recipient(String(id), `ผู้ร่วมงานตัวอย่าง ${index + 1}`, 'done'),
      ),
    ],
  } as Record<string, Participant[]>,
  queues: {} as Record<string, Queue>,
  imports: {} as Record<string, { eventId: string; rows: ImportRow[]; errors: string[]; committed: boolean }>,
  tickets: [
    {
      id: 'ticket-1',
      eventId: 'design-2026',
      title: 'สอบถามเมนูสำหรับผู้แพ้อาหาร',
      type: 'unanswered',
      description: 'ยืนยันเข้าร่วมแล้ว แต่ต้องการทราบว่ามีเมนูปลอดถั่วหรือไม่',
      status: 'open',
      assigneeIds: [],
      dueDate: '',
      version: 1,
      comments: [],
      activity: ['AI เปิด ticket · ผู้เข้าร่วมยืนยันแล้ว'],
    },
    ...[
      {
        id: 'ticket-2',
        title: 'ขอรายละเอียดที่จอดรถ',
        status: 'in_progress',
        assigneeIds: ['studio-ops', 'studio-support'],
      },
      {
        id: 'ticket-3',
        title: 'ยืนยันช่องทางรับบัตรเข้างาน',
        status: 'resolved',
        assigneeIds: ['studio-ops'],
      },
      {
        id: 'ticket-4',
        title: 'รอยืนยันสิ่งอำนวยความสะดวก',
        status: 'waiting',
        assigneeIds: ['studio-support'],
      },
    ].map((ticket) => ({
      ...ticket,
      eventId: 'design-2026',
      type: 'callback',
      description: 'ข้อมูลตัวอย่างสำหรับทดลองติดตามงาน',
      dueDate: '',
      version: 1,
      comments: [],
      activity: ['Demo follow-up ticket'],
    })),
  ] as Ticket[],
  credentials: [] as Credential[],
  members: [
    { id: 'member-1', email: 'admin@otterheaven.com', role: 'org_admin', eventIds: [], status: 'active' },
  ],
  idempotency: new Map<string, unknown>(),
};
export function queueFor(id: string): Queue {
  return (state.queues[id] ??= {
    ratio: 2,
    retryRatio: 1,
    version: 1,
    newSinceFail: 0,
    dispatchPosition: 0,
    status: 'idle',
    maxAttempts: 3,
    delayMinutes: 15,
    pendingTurn: false,
  });
}
