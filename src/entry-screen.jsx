import React from 'react';
import { createRoot } from 'react-dom/client';
import { ScreenPage } from './pages/ScreenPage.jsx';
import './styles/app.css';

const inPagesDir = /\/pages(?:-v2)?\//.test(window.location.pathname);

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ScreenPage inPagesDir={inPagesDir} />
  </React.StrictMode>
);
