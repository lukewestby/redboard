
import React, { useEffect, useMemo, useState } from 'react'
import { useRecoilState, useSetRecoilState } from 'recoil'
import Modal from 'react-modal'
import { useNavigate, useLocation } from 'react-router-dom'
import { username$, headerStyle$ } from '../state'


const Home = () => {
  const [username, setUsername] = useRecoilState(username$)
  const [usernameInput, setUsernameInput] = useState(username ?? '')
  const setHeaderStyle = useSetRecoilState(headerStyle$)
  const navigate = useNavigate()
  const location = useLocation()
  const returnToBoardId = useMemo(() => {
    if (!(typeof location.state === 'object') || location.state === null) return null
    const state = location.state as { returnTo: string | null }
    return state.returnTo
  }, [location.state])

  useEffect(() => {
    setHeaderStyle('Large')
  }, [setHeaderStyle])

  useEffect(() => {
    if (username === null) return
    const boardId = returnToBoardId ?? crypto.randomUUID()
    navigate(`/board/${boardId}`, { replace: true })
  }, [username, returnToBoardId])

  return (
    <Modal isOpen={username === null}>
      <div className="px-12 py-16 text-gray-900 w-108 font-archivo">
        <h3 className="text-3xl font-semibold text-center pb-2">Welcome to redboard!</h3>
        <p className="text-gray-500 text-center pb-12">Tell use your name to get started</p>
        <input
          className="block w-full border-3 border-gray-900 rounded-md px-4 py-3 mb-4 focus:outline-none focus:border-red-900"
          type="text"
          placeholder="Your Name"
          value={usernameInput}
          onChange={(event) => setUsernameInput(event.target.value)} />
        <button
          className="block bg-gray-900 text-white px-4 py-3 w-full rounded-md font-semibold"
          type="button"
          onClick={() => setUsername(usernameInput)}>
          Submit
        </button>
      </div>
    </Modal>
  )
}

export default Home
