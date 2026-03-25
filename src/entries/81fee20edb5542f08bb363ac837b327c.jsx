import React from 'react';
import { createRoot } from 'react-dom/client';
import { AccumulationEditorPage } from '../pages/AccumulationEditorPage.jsx';
import '../styles/app.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AccumulationEditorPage />
  </React.StrictMode>
);
