import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AsentumProvider } from '@asentum/connect';
import App from './App';
import { RPC_URL } from './lib/rpc';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AsentumProvider rpc={RPC_URL} dappName="Strata" telegramBot="AsentumWalletBot">
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AsentumProvider>
  </StrictMode>,
);
