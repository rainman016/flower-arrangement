import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import CorePrototype from './app/CorePrototype'
import './styles/theme.css'
createRoot(document.getElementById('root')!).render(<StrictMode><CorePrototype/></StrictMode>)
