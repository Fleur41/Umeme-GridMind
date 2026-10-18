import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import Overview from "./pages/Overview";
import TopologyPage from "./pages/TopologyPage";
import Simulation from "./pages/Simulation";
import Reasoning from "./pages/Reasoning";
import LearningLab from "./pages/LearningLab";
import Scenarios from "./pages/Scenarios";
import HistoryPage from "./pages/HistoryPage";
import About from "./pages/About";

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/topology" element={<TopologyPage />} />
        <Route path="/simulation" element={<Simulation />} />
        <Route path="/reasoning" element={<Reasoning />} />
        <Route path="/reasoning/:id" element={<Reasoning />} />
        <Route path="/learning" element={<LearningLab />} />
        <Route path="/scenarios" element={<Scenarios />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/about" element={<About />} />
        <Route path="*" element={<div className="text-ink-2">Page not found.</div>} />
      </Routes>
    </Layout>
  );
}
