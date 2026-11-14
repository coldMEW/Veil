import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { registerSW } from './lib/runtime/registerSW';
import '@fontsource-variable/outfit/wght.css';
import './styles/index.css';
import { initializeNative } from './lib/native/platform';
import { NativeModels } from './lib/native/NativeModels';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <App />
    <NativeModels />
  </StrictMode>,
);

void initializeNative();
void registerSW();
