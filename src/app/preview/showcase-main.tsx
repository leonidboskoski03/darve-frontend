import { createRoot } from 'react-dom/client';
import { Showcase } from './showcase';

const root = document.getElementById('root');
if (!root) throw new Error('Showcase root missing');
createRoot(root).render(<Showcase />);
