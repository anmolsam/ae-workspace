import { getServerSession } from 'next-auth';
import { notFound, redirect } from 'next/navigation';
import { authOptions } from '../../../lib/auth';
import { getBriefRecordById } from '../../../lib/airtable';
import { recordToBriefDetail } from '../../../lib/briefs';
import { BriefDetailClient } from '../../../components/BriefDetailClient';

export default async function BriefDetailPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const dealOwner = (session?.user as { dealOwner?: string } | undefined)?.dealOwner;
  if (!session || !dealOwner) redirect('/login');

  const record = await getBriefRecordById(params.id, dealOwner);
  if (!record) notFound();

  return <BriefDetailClient initialBrief={recordToBriefDetail(record)} />;
}
