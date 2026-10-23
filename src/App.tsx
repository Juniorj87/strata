import { Route, Routes } from 'react-router-dom';
import { Shell } from './components/Shell';
import { Home } from './pages/Home';
import { Strategies } from './pages/Strategies';
import { StrategyDetail } from './pages/StrategyDetail';
import { Deploy } from './pages/Deploy';
import { How } from './pages/How';

export default function App() {
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/strategies" element={<Strategies />} />
        <Route path="/strategies/:address" element={<StrategyDetail />} />
        <Route path="/deploy" element={<Deploy />} />
        <Route path="/how" element={<How />} />
        <Route path="*" element={<Home />} />
      </Routes>
    </Shell>
  );
}
