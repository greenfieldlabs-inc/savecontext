import { DashboardShell } from '@/components/dashboard/layout/dashboard-shell';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { Toaster } from 'sonner';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <ErrorBoundary>
        <DashboardShell>{children}</DashboardShell>
      </ErrorBoundary>
      <Toaster
        position="bottom-right"
        theme="dark"
        toastOptions={{
          style: {
            background: '#18181b',
            border: '1px solid #3f3f46',
            color: '#fafafa',
            maxWidth: '250px',
          },
        }}
      />
    </>
  );
}
