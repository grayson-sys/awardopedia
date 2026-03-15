import { Routes, Route } from 'react-router-dom';
import { createContext, useState, useContext } from 'react';
import Nav from './components/Nav';
import Footer from './components/Footer';
import Home from './pages/Home';
import Awards from './pages/Awards';
import AwardDetail from './pages/AwardDetail';
import Agencies from './pages/Agencies';
import AgencyProfile from './pages/AgencyProfile';
import NaicsProfile from './pages/NaicsProfile';
import ContractorProfile from './pages/ContractorProfile';
import Expiring from './pages/Expiring';
import About from './pages/About';
import Credits from './pages/Credits';

export const CreditsContext = createContext(null);

export function useCredits() {
  return useContext(CreditsContext);
}

export default function App() {
  const [user, setUser] = useState(null);
  const [credits, setCredits] = useState(0);

  const creditsValue = { user, setUser, credits, setCredits };

  return (
    <CreditsContext.Provider value={creditsValue}>
      <Nav />
      <main style={{ minHeight: 'calc(100vh - 200px)' }}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/awards" element={<Awards />} />
          <Route path="/awards/:id" element={<AwardDetail />} />
          <Route path="/agencies" element={<Agencies />} />
          <Route path="/agencies/:code" element={<AgencyProfile />} />
          <Route path="/naics/:code" element={<NaicsProfile />} />
          <Route path="/contractors/:uei" element={<ContractorProfile />} />
          <Route path="/expiring" element={<Expiring />} />
          <Route path="/about" element={<About />} />
          <Route path="/credits" element={<Credits />} />
        </Routes>
      </main>
      <Footer />
    </CreditsContext.Provider>
  );
}
