import { Route, Routes } from 'react-router-dom';
import { Shell } from './components/Shell';
import { Home } from './pages/Home';
import { Strategies } from './pages/Strategies';
import { StrategyDetail } from './pages/StrategyDetail';
import { Deploy } from './pages/Deploy';
import { How } from './pages/How';
import { Leaderboard } from './pages/Leaderboard';
import { Analytics } from './pages/Analytics';
import { Activity } from './pages/Activity';
import { Portfolio } from './pages/Portfolio';
import { Marketplace } from './pages/Marketplace';
import { Swap } from './pages/Swap';

export default function App() {
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/deploy" element={<Deploy />} />
        <Route path="/swap" element={<Swap />} />
        <Route path="/portfolio" element={<Portfolio />} />
        <Route path="/strategies" element={<Strategies />} />
        <Route path="/strategies/:address" element={<StrategyDetail />} />
        <Route path="/leaderboard" element={<Leaderboard />} />
        <Route path="/marketplace" element={<Marketplace />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/activity" element={<Activity />} />
        <Route path="/how" element={<How />} />
        <Route path="*" element={<Home />} />
      </Routes>
    </Shell>
  );
}
