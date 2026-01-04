import { NextResponse } from 'next/server';
import { Database } from 'bun:sqlite';
import { join } from 'path';
import { homedir } from 'os';

function getWriteDb() {
  const dbPath = join(homedir(), '.savecontext', 'data', 'savecontext.db');
  return new Database(dbPath);
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ error: 'Missing plan id' }, { status: 400 });
    }

    const db = getWriteDb();
    const now = Date.now();

    // Get current plan to check for project_path change
    const currentPlan = db.prepare('SELECT project_path FROM plans WHERE id = ?').get(id) as { project_path: string } | undefined;
    if (!currentPlan) {
      db.close();
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
    }

    // Track if we need to cascade project change to issues
    let newProjectId: string | null = null;
    let newProjectPath: string | null = null;

    // If project_path is changing, look up the new project
    if (updates.project_path !== undefined && updates.project_path !== currentPlan.project_path) {
      const newProject = db.prepare('SELECT id FROM projects WHERE project_path = ?').get(updates.project_path) as { id: string } | undefined;
      if (!newProject) {
        db.close();
        return NextResponse.json({ error: `Project not found for path: ${updates.project_path}` }, { status: 400 });
      }
      newProjectId = newProject.id;
      newProjectPath = updates.project_path;

      // Also update project_id in the plan
      updates.project_id = newProject.id;
    }

    // Build dynamic update query
    const allowedFields = ['title', 'content', 'status', 'success_criteria', 'project_path', 'project_id'];
    const setClauses: string[] = ['updated_at = ?'];
    const values: (string | number | null)[] = [now];

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        setClauses.push(`${field} = ?`);
        values.push(updates[field]);
      }
    }

    // Handle completed_at for completed status
    if (updates.status === 'completed') {
      setClauses.push('completed_at = ?');
      values.push(now);
    } else if (updates.status && updates.status !== 'completed') {
      setClauses.push('completed_at = NULL');
    }

    values.push(id);
    db.prepare(`UPDATE plans SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);

    // Cascade project change to all linked issues
    if (newProjectPath) {
      db.prepare(`
        UPDATE issues
        SET project_path = ?, updated_at = ?
        WHERE plan_id = ?
      `).run(newProjectPath, now, id);
    }

    db.close();

    return NextResponse.json({ success: true, cascaded: newProjectPath !== null });
  } catch (error) {
    console.error('Error updating plan:', error);
    return NextResponse.json({ error: 'Failed to update plan' }, { status: 500 });
  }
}
