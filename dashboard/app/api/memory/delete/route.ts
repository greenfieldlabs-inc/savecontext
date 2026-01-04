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
    const projectPath = searchParams.get('projectPath');
    const key = searchParams.get('key');

    if (!projectPath || !key) {
      return NextResponse.json({ error: 'Missing projectPath or key' }, { status: 400 });
    }

    const db = getWriteDb();
    db.prepare('DELETE FROM project_memory WHERE project_path = ? AND key = ?').run(projectPath, key);
    db.close();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting memory:', error);
    return NextResponse.json({ error: 'Failed to delete memory' }, { status: 500 });
  }
}
