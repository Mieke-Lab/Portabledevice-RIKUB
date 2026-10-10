import { Header } from "@/components/gcs/Header";
import { Sidebar } from "@/components/gcs/Sidebar";
import { DroneTelemetryProvider } from "@/components/gcs/DroneTelemetryProvider";

export function GcsLayout({ children }) {
  return (
    <div className="gcs-app flex min-h-screen flex-col bg-gcs-bg font-body text-gcs-on-surface">
      <DroneTelemetryProvider />
      <Header />
      <div className="flex h-screen overflow-hidden pt-16">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
          <div className="mx-auto w-full max-w-[1440px]">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
