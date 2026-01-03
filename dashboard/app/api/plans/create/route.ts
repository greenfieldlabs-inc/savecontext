import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import { join, basename } from 'path';
import { homedir } from 'os';

function getWriteDb() {
  const dbPath = join(homedir(), '.savecontext', 'data', 'savecontext.db');
  return new Database(dbPath);
}

function getProject(db: Database.Database, projectPath: string): { id: string } | null {
  const existing = db.prepare(
    'SELECT id FROM projects WHERE project_path = ?'
  ).get(projectPath) as { id: string } | undefined;

  return existing || null;
}

function generateShortId(db: Database.Database, projectId: string): string {
  // Get and increment the next plan number for this project
  const project = db.prepare(
    'SELECT next_plan_number FROM projects WHERE id = ?'
  ).get(projectId) as { next_plan_number: number } | undefined;

  const nextNum = project?.next_plan_number || 1;

  // Update the counter
  db.prepare(
    'UPDATE projects SET next_plan_number = ?, updated_at = ? WHERE id = ?'
  ).run(nextNum + 1, Date.now(), projectId);

  return `P-${nextNum}`;
}

export async function POST(request: Request) {
  try {
    const { projectPath, title, content, status, successCriteria } = await request.json();

    if (!projectPath || !title) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const db = getWriteDb();
    const now = Date.now();
    const id = crypto.randomUUID();

    // Get project - must exist
    const project = getProject(db, projectPath);
    if (!project) {
      db.close();
      return NextResponse.json({ error: 'Project not found. Create the project first using context_project_create.' }, { status: 404 });
    }
    const projectId = project.id;
    const shortId = generateShortId(db, projectId);

    db.prepare(`
      INSERT INTO plans (id, short_id, project_id, project_path, title, content, status, success_criteria, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, shortId, projectId, projectPath, title, content || null, status || 'draft', successCriteria || null, now, now);

    db.close();
    return NextResponse.json({ success: true, id, short_id: shortId });
  } catch (error) {
    console.error('Error creating plan:', error);
    return NextResponse.json({ error: 'Failed to create plan' }, { status: 500 });
  }
}
