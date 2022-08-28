import.meta.hot && import.meta.hot.decline()

import './index.css'
import React from 'react'
import { createRoot } from 'react-dom/client'
import Modal from 'react-modal'
import App from './app'


const rootElement = document.querySelector('[data-root]')! as HTMLElement
const root = createRoot(rootElement)
Modal.setAppElement(rootElement)


root.render(<App />)
