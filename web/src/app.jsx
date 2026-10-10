import { BrowserRouter, Routes, Route, useLocation, Navigate } from 'react-router-dom';
import { Splash } from './pages/Splash.jsx';
import { Menu } from './pages/Menu.jsx';
import { Maps } from './pages/Maps.jsx';
import { Mapping } from './pages/Mapping.jsx';
import { MappingPlan } from './pages/MappingPlan.jsx';
import { MappingDetail } from './pages/MappingDetail.jsx';
import { FlightPlan } from './pages/FlightPlan.jsx';
import { Monitoring } from './pages/Monitoring.jsx';
import { Detection } from './pages/Detection.jsx';
import { Chatbot } from './pages/Chatbot.jsx';
import { DroneDashboard } from './pages/DroneDashboard.jsx';
import { VirtualKeyboard } from './components/VirtualKeyboard.jsx';

// Keyed wrapper: remount on path change replays the fade-up enter animation.
function AnimatedRoutes() {
  const location = useLocation();
  const isGcs = location.pathname.startsWith('/drone-dashboard');
  return (
    <div key={isGcs ? 'gcs' : location.pathname} className={isGcs ? 'h-full' : 'h-full animate-fade-up'}>
      <Routes location={location}>
        <Route path="/" element={<Splash />} />
        <Route path="/menu" element={<Menu />} />
        <Route path="/maps" element={<Maps />} />
        <Route path="/mapping" element={<Mapping />} />
        <Route path="/mapping/plan" element={<MappingPlan />} />
        <Route path="/mapping/:id" element={<MappingDetail />} />
        <Route path="/flight-plan" element={<FlightPlan />} />
        <Route path="/monitoring" element={<Monitoring />} />
        <Route path="/drone-dashboard/*" element={<DroneDashboard />} />
        <Route path="/detection" element={<Detection />} />
        <Route path="/chatbot" element={<Chatbot />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AnimatedRoutes />
      <VirtualKeyboard />
    </BrowserRouter>
  );
}
