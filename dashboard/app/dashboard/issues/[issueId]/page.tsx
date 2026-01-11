import { notFound } from 'next/navigation';
import { getIssueById, getAllProjects } from '@/lib/db-adapter';
import { IssueDetailPage } from './client';

export const dynamic = 'force-dynamic';

type Params = Promise<{ issueId: string }>;

export default async function Page({ params }: { params: Params }) {
  const { issueId } = await params;

  const [issue, projects] = await Promise.all([
    getIssueById(issueId),
    getAllProjects()
  ]);

  if (!issue) {
    notFound();
  }

  return <IssueDetailPage issue={issue} projects={projects} />;
}
