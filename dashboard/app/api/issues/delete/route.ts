import { NextResponse } from 'next/server';
import { Database } from 'bun:sqlite';
import { join } from 'path';
import { homedir } from 'os';

function getWriteDb() {
  const dbPath = join(homedir(), '.savecontext', 'data', 'savecontext.db');
  return new Database(dbPath);
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Missing issue id' }, { status: 400 });
    }

    const db = getWriteDb();
    // Delete subtasks first (children found via dependencies table)
    db.prepare(`
      DELETE FROM issues WHERE id IN (
        SELECT issue_id FROM issue_dependencies
        WHERE depends_on_id = ? AND dependency_type = 'parent-child'
      )
    `).run(id);
    // Delete issue (CASCADE will handle dependencies)
    db.prepare('DELETE FROM issues WHERE id = ?').run(id);
    db.close();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting issue:', error);
    return NextResponse.json({ error: 'Failed to delete issue' }, { status: 500 });
  }
}
