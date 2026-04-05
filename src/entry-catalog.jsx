import React from 'react';
import { createRoot } from 'react-dom/client';
import { CatalogPage } from './pages/CatalogPage.jsx';
import './styles/app.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <CatalogPage />
  </React.StrictMode>
);
