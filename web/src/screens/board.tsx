
import React, { useRef, useEffect, Suspense, useCallback, MouseEvent, RefObject, useState } from 'react'
import { useRecoilCallback, useRecoilValue, useSetRecoilState, RecoilRoot, useRecoilState } from 'recoil'
import { useNavigate, useParams } from 'react-router-dom'
import { username$, objectIds$, squares$, circles$, headerStyle$, stars$, Star, Session, objects$, selectedObjectId$, triangles$, Triangle, textboxes$, Textbox, Square, Circle, boardId$, cursors$, sessions$, headerSessions$, HeaderStyle, sessionId$, connected$ } from '../state'
import { ObjectIdsProtocolSync, ObjectProtocolSync, PresenceProtocolSync, ConnectedProtocolSync } from '../sync'
import RenderObject from '../components/render_object'
import Cursor from '../components/cursor'
import { throttle } from 'throttle-debounce'
import { useMemo } from 'react'

const ActualBoard = ({
  boardId,
  sessionId,
  onSessionsChanged,
}: {
  boardId: string,
  sessionId: string,
  onSessionsChanged: (sessions: Array<Session>) => void,
}) => {
  const connected = useRecoilValue(connected$)
  const objectIds = useRecoilValue(objectIds$(boardId))
  const [selectedObjectId, setSelectedObjectId] = useRecoilState(selectedObjectId$)
  const setBoardId = useSetRecoilState(boardId$)
  const sessions = useRecoilValue(sessions$)

  const [firstLoadCompleted, setFirstLoadCompleted] = useState(false)

  useEffect(() => {
    if (connected) setFirstLoadCompleted(true)
  }, [connected, setFirstLoadCompleted])

  useEffect(() => {
    onSessionsChanged(sessions)
  }, [sessions])

  const addSquare = useRecoilCallback(({ set }) => () => {
    const squareId = crypto.randomUUID()
    set(squares$(squareId), Square.default())
    set(selectedObjectId$, squareId)
  }, [])

  const addCircle = useRecoilCallback(({ set }) => () => {
    const circleId = crypto.randomUUID()
    set(circles$(circleId), Circle.default())
    set(selectedObjectId$, circleId)
  }, [])

  const addStar = useRecoilCallback(({ set }) => () => {
    const starId = crypto.randomUUID()
    set(stars$(starId), Star.default())
    set(selectedObjectId$, starId)
  }, [])

  const addTriangle = useRecoilCallback(({ set }) => () => {
    const triangleId = crypto.randomUUID()
    set(triangles$(triangleId), Triangle.default())
    set(selectedObjectId$, triangleId)
  })

  const addTextbox = useRecoilCallback(({ set }) => () => {
    const textboxId = crypto.randomUUID()
    set(textboxes$(textboxId), Textbox.default())
    set(selectedObjectId$, textboxId)
  })

  const deleteSelectedObject = useRecoilCallback(({ reset }) => () => {
    if (selectedObjectId === null) return
    reset(objects$(selectedObjectId))
  }, [selectedObjectId])

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.code !== 'Backspace') return
      deleteSelectedObject()
    }
    window.addEventListener('keyup', listener)
    return () => window.removeEventListener('keyup', listener)
  }, [deleteSelectedObject])

  useEffect(() => {
    const listener = () => setSelectedObjectId(null)
    window.addEventListener('click', listener)
    return () => window.removeEventListener('click', listener)
  }, [setSelectedObjectId])

  useEffect(() => {
    setBoardId(boardId)
  }, [boardId])

  const containerRef = useRef<HTMLDivElement | null>(null)
  const controlsRef = useRef<HTMLDivElement | null>(null)

  const cursorPresent = useRef(false)
  const setCursor = useRecoilCallback(({ set }) => (x: number, y: number) => {
    if (!cursorPresent.current) return
    set(cursors$(sessionId), { x, y })
  }, [sessionId, cursorPresent])
  const onMouseMoveThrottled = useCallback(throttle(200, setCursor), [setCursor])
  const onMouseMove = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const rect = containerRef.current!.getBoundingClientRect()
    onMouseMoveThrottled(event.clientX - rect.left, event.clientY - rect.top)
  }, [onMouseMoveThrottled])
  const onMouseLeave = useRecoilCallback(({ set }) => () => {
    cursorPresent.current = false
    set(cursors$(sessionId), null)
  }, [sessionId,])
  const onMouseEnter = useCallback((event: MouseEvent<HTMLDivElement>) => {
    cursorPresent.current = true
    onMouseMove(event)
  }, [onMouseMove])

  return (
    <div
      style={{ width: '100%', height: '100%', position: 'absolute' }}
      ref={containerRef}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onMouseMove={onMouseMove}>
      <div style={{ width: '100%', height: '100%', position: 'absolute' }}>
        {[...objectIds].map((objectId) => (
          <Suspense key={objectId}>
            <RenderObject objectId={objectId} />
          </Suspense>
        ))}
      </div>
      <div
        ref={controlsRef}
        className="absolute bottom-12 w-full flex items-center justify-center pointer-events-none">
        <div
          onClick={(event) => event.stopPropagation()}
          className="bg-gray-900 text-white rounded-md p-2 flex divide-x divide-white pointer-events-auto">
          <button
            className="flex items-center justify-center p-2 pr-4"
            type="button"
            onClick={addStar}>
            <span className="material-symbols-outlined">star</span>
          </button>
          <button
            className="flex items-center justify-center px-4 py-2"
            type="button"
            onClick={addSquare}>
            <span className="material-symbols-outlined">check_box_outline_blank</span>
          </button>
          <button
            className="flex items-center justify-center px-4 py-2"
            type="button"
            onClick={addCircle}>
            <span className="material-symbols-outlined">radio_button_unchecked</span>
          </button>
          <button
            className="flex items-center justify-center px-4 py-2"
            type="button"
            onClick={addTriangle}>
            <span className="material-symbols-outlined">change_history</span>
          </button>
          <button
            className="flex items-center justify-center p-2 pl-4 font-times text-2xl"
            type="button"
            onClick={addTextbox}>
            <span className="w-6">T</span>
          </button>
        </div>
      </div>
      <div className="h-full w-full absolute top-0 left-0 pointer-events-none z-40">
        {[...sessions].map((session) => (
          <Suspense key={session.id} >
            <Cursor sessionId={session.id} />
          </Suspense>
        ))}
      </div>
      {!connected && (
        <div className="h-full w-full top-0 left-0 absolute z-50">
          <div className="h-full w-full top-0 left-0 absolute bg-black opacity-40" />
          <div className="h-full w-full top-0 left-0 absolute flex items-center justify-center text-3xl text-white font-archivo">
            {firstLoadCompleted ? 'Reconnecting...' : 'Loading...'}
          </div>
        </div>
      )}
    </div>
  )
}

const useSessionId = (navigating: RefObject<boolean>) => {
  const defaultSessionId = useMemo(() => crypto.randomUUID(), [])
  const [sessionIdState, setSessionId] = useRecoilState(sessionId$)

  useEffect(() => {
    if (navigating.current) return
    if (sessionIdState === null) setSessionId(defaultSessionId)
  }, [sessionIdState, setSessionId, defaultSessionId])

  const sessionId = useMemo(() => {
    return sessionIdState ?? defaultSessionId
  }, [sessionIdState, defaultSessionId])

  return sessionId
}

const Board = () => {
  const navigating = useRef(false)

  const boardId = useParams<'boardId'>().boardId ?? null
  const navigate = useNavigate()
  const username = useRecoilValue(username$)
  const sessionId = useSessionId(navigating)

  const onSessionsChanged = useRecoilCallback(({ set }) => (sessions: Array<Session>) => {
    if (navigating.current) return
    set(headerSessions$, sessions)
  }, [])

  useEffect(() => {
    if (username === null) {
      navigating.current = true
      navigate('/', { replace: true, state: { returnTo: boardId } })
      return
    }

    if (boardId === null) {
      navigating.current = true
      navigate(`/board/${crypto.randomUUID()}`, { replace: true })
      return
    }
  }, [boardId, username])

  const setHeaderStyle = useRecoilCallback(({ set }) => (headerStyle: HeaderStyle) => {
    if (navigating.current) return
    set(headerStyle$, headerStyle)
  })
  useEffect(() => {
    setHeaderStyle('Small')
  }, [setHeaderStyle])

  if (boardId === null || username === null) return null

  return (
    <RecoilRoot>
      <ObjectProtocolSync
        boardId={boardId}
        sessionId={sessionId}
        username={username}
        storeKey="ObjectProtocol">
        <ObjectIdsProtocolSync
          boardId={boardId}
          sessionId={sessionId}
          username={username}
          storeKey="ObjectIdsProtocol">
          <PresenceProtocolSync
            boardId={boardId}
            sessionId={sessionId}
            username={username}
            storeKey="PresenceProtocol">
            <ConnectedProtocolSync
              boardId={boardId}
              sessionId={sessionId}
              username={username}
              storeKey="ConnectedProtocol">
              <Suspense>
                <ActualBoard
                  boardId={boardId}
                  sessionId={sessionId}
                  onSessionsChanged={onSessionsChanged} />
              </Suspense>
            </ConnectedProtocolSync>
          </PresenceProtocolSync>
        </ObjectIdsProtocolSync>
      </ObjectProtocolSync>
    </RecoilRoot>
  )
}

export default Board
