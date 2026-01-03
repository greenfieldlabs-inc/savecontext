import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import { join } from 'path';
import { homedir } from 'os';

function getWriteDb() {
  const dbPath = join(homedir(), '.savecontext', 'data', 'savecontext.db');
  return new Database(dbPath);
}

// GET: Fetch tasks that will be deleted with this plan (for confirmation)
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Missing plan id' }, { status: 400 });
    }

    const db = getWriteDb();
    let issues: { id: string; short_id: string; title: string }[] = [];

    try {
      issues = db.prepare('SELECT id, short_id, title FROM issues WHERE plan_id = ?').all(id) as any[];
    } catch {
      // plan_id column doesn't exist - no issues linked
    }

    db.close();
    return NextResponse.json({ success: true, issues });
  } catch (error) {
    console.error('Error fetching plan issues:', error);
    return NextResponse.json({ error: 'Failed to fetch plan issues' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { id } = await request.json();

    if (!id) {
      return NextResponse.json({ error: 'Missing plan id' }, { status: 400 });
    }

    const db = getWriteDb();
    let deletedIssueCount = 0;

    // Delete issues associated with this plan (if plan_id column exists)
    try {
      const result = db.prepare('DELETE FROM issues WHERE plan_id = ?').run(id);
      deletedIssueCount = result.changes;
    } catch {
      // plan_id column doesn't exist in this schema - skip
    }

    // Delete plan
    db.prepare('DELETE FROM plans WHERE id = ?').run(id);
    db.close();

    return NextResponse.json({ success: true, deletedIssueCount });
  } catch (error) {
    console.error('Error deleting plan:', error);
    return NextResponse.json({ error: 'Failed to delete plan' }, { status: 500 });
  }
}
