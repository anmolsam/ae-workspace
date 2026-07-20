import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../lib/auth';
import { getBriefRecordById } from '../../../../lib/airtable';
import { recordToBriefDetail } from '../../../../lib/briefs';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const dealOwner = (session?.user as { dealOwner?: string } | undefined)?.dealOwner;

  if (!session || !dealOwner) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  const record = await getBriefRecordById(params.id, dealOwner);
  if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json(recordToBriefDetail(record));
}
