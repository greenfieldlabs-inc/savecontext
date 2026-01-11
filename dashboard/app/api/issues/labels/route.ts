import { NextResponse } from 'next/server';
import { getWriteDatabase } from '@/lib/db';
import { emitIssueEvent } from '@/lib/events';

// Add labels to an issue
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { issueId, labels } = body;

    if (!issueId) {
      return NextResponse.json({ error: 'Missing issueId' }, { status: 400 });
    }

    if (!labels || !Array.isArray(labels) || labels.length === 0) {
      return NextResponse.json({ error: 'Missing or invalid labels array' }, { status: 400 });
    }

    const db = getWriteDatabase();
    const now = Date.now();

    // Add each label (ignore duplicates due to UNIQUE constraint)
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO issue_labels (id, issue_id, label)
      VALUES (?, ?, ?)
    `);

    const addedLabels: string[] = [];
    for (const label of labels) {
      const trimmedLabel = String(label).trim();
      if (trimmedLabel) {
        const id = crypto.randomUUID();
        const result = insertStmt.run(id, issueId, trimmedLabel);
        if (result.changes > 0) {
          addedLabels.push(trimmedLabel);
        }
      }
    }

    // Update issue's updated_at
    db.prepare('UPDATE issues SET updated_at = ? WHERE id = ?').run(now, issueId);
    emitIssueEvent('updated', issueId);

    return NextResponse.json({
      success: true,
      addedLabels,
      message: `Added ${addedLabels.length} label(s)`
    });
  } catch (error) {
    console.error('Error adding labels:', error);
    return NextResponse.json({ error: 'Failed to add labels' }, { status: 500 });
  }
}

// Remove labels from an issue
export async function DELETE(request: Request) {
  try {
    const body = await request.json();
    const { issueId, labels } = body;

    if (!issueId) {
      return NextResponse.json({ error: 'Missing issueId' }, { status: 400 });
    }

    if (!labels || !Array.isArray(labels) || labels.length === 0) {
      return NextResponse.json({ error: 'Missing or invalid labels array' }, { status: 400 });
    }

    const db = getWriteDatabase();
    const now = Date.now();

    // Remove each label
    const deleteStmt = db.prepare(`
      DELETE FROM issue_labels WHERE issue_id = ? AND label = ?
    `);

    let removedCount = 0;
    for (const label of labels) {
      const result = deleteStmt.run(issueId, String(label).trim());
      removedCount += result.changes;
    }

    // Update issue's updated_at
    db.prepare('UPDATE issues SET updated_at = ? WHERE id = ?').run(now, issueId);
    emitIssueEvent('updated', issueId);

    return NextResponse.json({
      success: true,
      removedCount,
      message: `Removed ${removedCount} label(s)`
    });
  } catch (error) {
    console.error('Error removing labels:', error);
    return NextResponse.json({ error: 'Failed to remove labels' }, { status: 500 });
  }
}

// Set all labels for an issue (replace existing)
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { issueId, labels } = body;

    if (!issueId) {
      return NextResponse.json({ error: 'Missing issueId' }, { status: 400 });
    }

    if (!labels || !Array.isArray(labels)) {
      return NextResponse.json({ error: 'Missing or invalid labels array' }, { status: 400 });
    }

    const db = getWriteDatabase();
    const now = Date.now();

    // Remove all existing labels
    db.prepare('DELETE FROM issue_labels WHERE issue_id = ?').run(issueId);

    // Add new labels
    const insertStmt = db.prepare(`
      INSERT INTO issue_labels (id, issue_id, label)
      VALUES (?, ?, ?)
    `);

    const addedLabels: string[] = [];
    for (const label of labels) {
      const trimmedLabel = String(label).trim();
      if (trimmedLabel) {
        const id = crypto.randomUUID();
        insertStmt.run(id, issueId, trimmedLabel);
        addedLabels.push(trimmedLabel);
      }
    }

    // Update issue's updated_at
    db.prepare('UPDATE issues SET updated_at = ? WHERE id = ?').run(now, issueId);
    emitIssueEvent('updated', issueId);

    return NextResponse.json({
      success: true,
      labels: addedLabels,
      message: `Set ${addedLabels.length} label(s)`
    });
  } catch (error) {
    console.error('Error setting labels:', error);
    return NextResponse.json({ error: 'Failed to set labels' }, { status: 500 });
  }
}
