import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { Gallery } from './screens/Gallery.tsx'

const gallery = new URLSearchParams(location.search).has('gallery')

createRoot(document.getElementById('root')!).render(<StrictMode>{gallery ? <Gallery /> : <App />}</StrictMode>)
