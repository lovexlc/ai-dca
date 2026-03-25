import React from 'react';
import { createRoot } from 'react-dom/client';
import { TradeHistoryPage } from '../pages/TradeHistoryPage.jsx';
import '../styles/app.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <TradeHistoryPage />
  </React.StrictMode>
);
