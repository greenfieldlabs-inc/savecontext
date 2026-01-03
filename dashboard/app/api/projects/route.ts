import { NextResponse } from 'next/server';
import { getAllProjects } from '@/lib/db';

export async function GET() {
  try {
    const projects = getAllProjects();

    // Transform to match expected UI format
    const formatted = projects.map((p) => ({
      id: p.id,
      name: p.name,
      sourcePath: p.project_path,
      sessionCount: p.session_count,
      activeSessions: p.active_sessions,
      totalItems: p.total_items,
    }));

    return NextResponse.json({ projects: formatted });
  } catch (error) {
    console.error('Error fetching projects:', error);
    return NextResponse.json({ error: 'Failed to fetch projects' }, { status: 500 });
  }
}
