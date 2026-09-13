import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Planner from './pages/Planner';
import Library from './pages/Library';
import MissionView from './pages/MissionView';
import Fields from './pages/Fields';
import Analytics from './pages/Analytics';
import Teleop from './pages/Teleop';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="planner" element={<Planner />} />
          <Route path="library" element={<Library />} />
          <Route path="mission/:id" element={<MissionView />} />
          <Route path="fields" element={<Fields />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="teleop" element={<Teleop />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
