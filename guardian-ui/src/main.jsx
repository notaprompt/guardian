import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/theme.css';
import './styles/panels.css';
import './styles/sidebar.css';
import './styles/terminal.css';
import './styles/terminal-window.css';
import './styles/accessibility.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
