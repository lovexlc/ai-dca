import React from 'react';
import { createRoot } from 'react-dom/client';
import { HOME_SCREEN_ID } from './app/screens.js';
import { ScreenPage } from './pages/ScreenPage.jsx';
import './styles/app.css';

const screenId = window.__SCREEN_ID__ || HOME_SCREEN_ID;
const inPagesDir = window.location.pathname.includes('/pages/');

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ScreenPage screenId={screenId} inPagesDir={inPagesDir} />
  </React.StrictMode>
);
