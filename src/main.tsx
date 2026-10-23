import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AsentumProvider } from '@asentum/connect';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AsentumProvider rpc="https://testnet.asentum.com" dappName="Strata">
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AsentumProvider>
  </StrictMode>,
);
