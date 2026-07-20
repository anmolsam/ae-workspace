import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../../lib/auth';
import { setBriefStatusRefreshing } from '../../../../../lib/airtable';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const dealOwner = (session?.user as { dealOwner?: string } | undefined)?.dealOwner;

  if (!session || !dealOwner) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  const updated = await setBriefStatusRefreshing(params.id, dealOwner);
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ ok: true });
}
