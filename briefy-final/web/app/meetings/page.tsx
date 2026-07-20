import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '../../lib/auth';
import { queryMeetingsForOwner } from '../../lib/airtable';
import { recordToMeetingSummary } from '../../lib/briefs';
import { MeetingList } from '../../components/MeetingList';

export default async function MeetingsPage() {
  const session = await getServerSession(authOptions);
  const dealOwner = (session?.user as { dealOwner?: string } | undefined)?.dealOwner;
  if (!session || !dealOwner) redirect('/login');

  const records = await queryMeetingsForOwner(dealOwner);
  const meetings = records.map(recordToMeetingSummary);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-6 text-xl font-semibold text-neutral-900">Your meetings</h1>
      <MeetingList meetings={meetings} />
    </main>
  );
}
