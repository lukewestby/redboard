
import React, { Suspense } from 'react'
import { RecoilRoot, useRecoilValue } from 'recoil'
import { BrowserRouter, Routes, Route, Outlet } from 'react-router-dom'
import clsx from 'clsx'
import { BrowserStorageSync } from './sync'
import { headerSessions$, headerStyle$, username$ } from './state'
import NotFound from './screens/not_found'
import Home from './screens/home'
import Board from './screens/board'
import Modal from 'react-modal'

Modal.defaultStyles.overlay! = {
  ...Modal.defaultStyles.overlay!,
  backgroundColor: 'rgba(0,0,0,0.5)',
  display: 'flex',
  justifyContent: 'center',
  paddingTop: '96px',
}
Modal.defaultStyles.content! = {
  ...Modal.defaultStyles.content!,
  inset: 'unset',
  borderRadius: 8,
  padding: 0,
  overflow: 'hidden',
}

const Header = () => {
  const headerStyle = useRecoilValue(headerStyle$)
  return (
    <header className={clsx('transition-all flex items-center flex-shrink-0 justify-between', {
      'h-16 px-8 bg-white': headerStyle === 'Large',
      'h-12 px-4 bg-gray-900': headerStyle === 'Small',
    })}>
      <div className={clsx('transition-transform transform origin-left text-2xl font-archivo', {
        'scale-200': headerStyle === 'Large',
        'scale-100': headerStyle === 'Small',
      })}>
        <span className={clsx('transition-colors', {
          'text-red-600': headerStyle === 'Large',
          'text-white': headerStyle === 'Small',
        })}>red</span>
        <span className={clsx('transition-colors', {
          'text-gray-700': headerStyle === 'Large',
          'text-white': headerStyle === 'Small'
        })}>board</span>
      </div>
      <Suspense>
        <SessionAvatars />
      </Suspense>
    </header>
  )
}

const SessionAvatars = () => {
  const headerSessions = useRecoilValue(headerSessions$)
  const username = useRecoilValue(username$)
  return (
    <div className="flex">
      {username && (
        <div className="h-6 w-6 rounded-full bg-gray-600 text-white border border-gray-400 font-archivo flex items-center justify-center">
          {username[0]?.toUpperCase() ?? '?'}
        </div>
      )}
      {headerSessions.map((session) => (
        <div key={session.id} className="origin-center h-6 w-6 ml-2 rounded-full bg-gray-600 text-white borde font-archivo flex items-center justify-center">
          {session.username[0]?.toUpperCase() ?? '?'}
        </div>
      ))}
    </div>
  )
}

const Layout = () => {
  return (
    <div className="h-full w-full flex flex-col relative">
      <Suspense>
        <Header />
      </Suspense>
      <main className="h-full w-full flex-shrink relative">
        <Outlet />
      </main>
    </div>
  )
}

const App = () => (
  <RecoilRoot>
    <BrowserStorageSync storeKey="LocalStorage" namespace="recoil" storage={localStorage}>
      <BrowserStorageSync storeKey="SessionStorage" namespace="recoil" storage={sessionStorage}>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={<Home />} />
              <Route path="*" element={<NotFound />} />
              <Route path="/board/:boardId" element={<Board />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </BrowserStorageSync>
    </BrowserStorageSync>
  </RecoilRoot>
)

export default App
