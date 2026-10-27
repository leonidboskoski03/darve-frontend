import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ComponentPreview } from './component-preview';
import { MotionProvider } from '@/motion/provider';
import '@/design-system/styles.css';
import './preview.css';

const root = document.getElementById('root');
if (!root) throw new Error('Preview root is missing.');
createRoot(root).render(
  <StrictMode>
    <MotionProvider>
      <ComponentPreview />
    </MotionProvider>
  </StrictMode>,
);
