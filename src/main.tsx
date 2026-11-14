import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { registerSW } from './lib/runtime/registerSW';
import '@fontsource-variable/geist/wght.css';
import './styles/index.css';
import { initializeNative } from './platform/native';
import { NativeModels } from './platform/NativeModels';

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

import './platform/native.css';
