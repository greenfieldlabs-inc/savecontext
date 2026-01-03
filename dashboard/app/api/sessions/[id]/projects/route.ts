import { NextResponse } from 'next/server';
import {
  getSessionById,
  getSessionProjectsInfo,
  addSessionProject,
  removeSessionProject,
  setSessionPrimaryProject,
  getAllProjects,
} from '@/lib/db';

type Params = Promise<{ id: string }>;

export async function GET(request: Request, { params }: { params: Params }) {
  try {
    const { id } = await params;

    // Check session exists
    const session = getSessionById(id);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const projects = getSessionProjectsInfo(id);

    return NextResponse.json({ projects });
  } catch (error) {
    console.error('Error fetching session projects:', error);
    return NextResponse.json({ error: 'Failed to fetch session projects' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { projectId } = body;

    if (!projectId) {
      return NextResponse.json({ error: 'Missing projectId' }, { status: 400 });
    }

    // Check session exists
    const session = getSessionById(id);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // Get project path from project ID
    const allProjects = getAllProjects();
    const project = allProjects.find((p) => p.id === projectId);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    addSessionProject(id, project.project_path);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error adding project to session:', error);
    return NextResponse.json({ error: 'Failed to add project to session' }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { projectId } = body;

    if (!projectId) {
      return NextResponse.json({ error: 'Missing projectId' }, { status: 400 });
    }

    // Check session exists
    const session = getSessionById(id);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // Get project path from project ID
    const allProjects = getAllProjects();
    const project = allProjects.find((p) => p.id === projectId);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    setSessionPrimaryProject(id, project.project_path);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error setting primary project:', error);
    return NextResponse.json({ error: 'Failed to set primary project' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { projectId } = body;

    if (!projectId) {
      return NextResponse.json({ error: 'Missing projectId' }, { status: 400 });
    }

    // Check session exists
    const session = getSessionById(id);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // Get current projects to validate we're not removing the last one
    const currentProjects = getSessionProjectsInfo(id);
    if (currentProjects.length <= 1) {
      return NextResponse.json({ error: 'Cannot remove the last project from a session' }, { status: 400 });
    }

    // Get project path from project ID
    const allProjects = getAllProjects();
    const project = allProjects.find((p) => p.id === projectId);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    removeSessionProject(id, project.project_path);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error removing project from session:', error);
    return NextResponse.json({ error: 'Failed to remove project from session' }, { status: 500 });
  }
}
