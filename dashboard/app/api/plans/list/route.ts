import { getPlans, getPlanStats } from '@/lib/db-adapter';
import { apiSuccess, apiServerError } from '@/lib/api-utils';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const projectPath = searchParams.get('projectPath') || undefined;
    const status = searchParams.get('status') || undefined;

    const plans = await getPlans(projectPath, status);
    const stats = await getPlanStats(projectPath);

    return apiSuccess({ plans, stats, count: plans.length });
  } catch (error) {
    console.error('Error fetching plans:', error);
    return apiServerError('Failed to fetch plans');
  }
}
