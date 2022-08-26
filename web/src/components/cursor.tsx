import React from 'react'
import { useRecoilValue } from 'recoil'
import { cursors$, usernames$ } from '../state'

const Cursor = ({
  sessionId,
}: {
  sessionId: string,
}) => {
  const username = useRecoilValue(usernames$(sessionId))
  const cursor = useRecoilValue(cursors$(sessionId))

  if (!cursor) return null

  return (
    <div
      className="transition-transform ease-linear duration-200 w-12 h-12 rounded-full rounded-tl-none bg-gray-600 flex items-center justify-center font-archivo text-xl"
      style={{
        transform: `translateX(${cursor.x}px) translateY(${cursor.y}px)`,
      }}>
      {username[0]?.toUpperCase() ?? '?'}
    </div>
  )
}

export default Cursor
