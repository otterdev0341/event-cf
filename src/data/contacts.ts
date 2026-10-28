import { getCampaigns, getDraft, nameColumn } from '../lib/campaigns';
export interface ImportedContact {
  id: string; name: string; phone: string; campaign: string; fileName: string;
  row: number; fields: Array<{ name: string; value: string }>;
}
// Contacts are derived only from user-imported CSV rows. No invented call results.
export function getImportedContacts(): ImportedContact[] {
  const campaigns = new Map(getCampaigns().map(campaign => [campaign.id, campaign]));
  const draft = getDraft();
  if (draft) campaigns.set(draft.id, draft);
  return [...campaigns.values()].flatMap(campaign => {
    const phoneIndex = campaign.csv.headers.findIndex(header => campaign.mapping[header] === 'phone');
    const nameIndex = nameColumn(campaign);
    return campaign.csv.rows.map((row, index) => ({
      id: `${campaign.id}:${index}`, name: nameIndex >= 0 ? row[nameIndex] : '', phone: phoneIndex >= 0 ? row[phoneIndex] : '',
      campaign: campaign.name, fileName: campaign.fileName, row: index + 1,
      fields: campaign.csv.headers.map((name, column) => ({ name, value: row[column] })),
    }));
  });
}
export function getContactById(id: string) { return getImportedContacts().find(contact => contact.id === id) ?? null; }
