import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/auth';
import { queryMeetingsForOwner } from '../../../lib/airtable';
import { recordToMeetingSummary } from '../../../lib/briefs';

export async function GET() {
  const session = await getServerSession(authOptions);
  const dealOwner = (session?.user as { dealOwner?: string } | undefined)?.dealOwner;

  if (!session) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  if (!dealOwner) return NextResponse.json({ error: 'No owner mapping' }, { status: 403 });

  const records = await queryMeetingsForOwner(dealOwner);
  const meetings = records.map(recordToMeetingSummary);

  return NextResponse.json({ meetings });
}
