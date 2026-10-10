import { Navigate, Route, Routes } from "react-router-dom";
import { GcsLayout } from "@/components/gcs/GcsLayout";
import { Dashboard } from "@/pages/gcs/Dashboard";
import { Mapping } from "@/pages/gcs/Mapping";
import { MappingDetail } from "@/pages/gcs/MappingDetail";
import { MappingNew } from "@/pages/gcs/MappingNew";
import { Spraying } from "@/pages/gcs/Spraying";
import { DroneTest } from "@/pages/gcs/DroneTest";
import { Copilot } from "@/pages/gcs/Copilot";
import { DroneSettings } from "@/pages/gcs/DroneSettings";
import { Logs } from "@/pages/gcs/Logs";
import { Settings } from "@/pages/gcs/Settings";

export function DroneDashboard() {
  return (
    <GcsLayout>
      <Routes>
        <Route index element={<Dashboard />} />
        <Route path="mapping" element={<Mapping />} />
        <Route path="mapping/new" element={<MappingNew />} />
        <Route path="mapping/:id" element={<MappingDetail />} />
        <Route path="spraying" element={<Spraying />} />
        <Route path="flight-test" element={<DroneTest />} />
        <Route path="copilot" element={<Copilot />} />
        <Route path="drone-settings" element={<DroneSettings />} />
        <Route path="logs" element={<Logs />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/drone-dashboard" replace />} />
      </Routes>
    </GcsLayout>
  );
}
