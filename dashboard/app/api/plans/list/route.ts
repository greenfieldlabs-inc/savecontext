import { NextResponse } from 'next/server';
import { getPlans, getPlanStats } from '@/lib/db-adapter';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const projectPath = searchParams.get('projectPath') || undefined;
    const status = searchParams.get('status') || undefined;

    const plans = await getPlans(projectPath, status);
    const stats = await getPlanStats(projectPath);

    return NextResponse.json({
      success: true,
      plans,
      stats,
      count: plans.length
    });
  } catch (error) {
    console.error('Error fetching plans:', error);
    return NextResponse.json(
      { error: 'Failed to fetch plans' },
      { status: 500 }
    );
  }
}
