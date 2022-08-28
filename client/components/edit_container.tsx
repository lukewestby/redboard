import React, { useCallback, useMemo, PointerEvent as ReactPointerEvent, useState, useEffect, useRef, ReactNode } from 'react'
import clsx from 'clsx'
import { Point } from '../core'
import { flushSync } from 'react-dom'

const EditContainer = ({
  width,
  height,
  offsetX,
  offsetY,
  selected,
  fixedAspectRatio,
  layer,
  dragDisabled,
  actions,
  onSelected,
  onDragEnd,
  onResizeEnd,
  children,
}: {
  width: number,
  height: number,
  offsetX: number,
  offsetY: number,
  selected: boolean,
  fixedAspectRatio: boolean,
  layer: number,
  dragDisabled: boolean,
  actions: Array<ReactNode>,
  onSelected: () => void,
  onDragEnd: (point: Point) => void,
  onResizeEnd: (point: Point) => void,
  children: (callbacks: {
    onPointerDown: (event: React.PointerEvent<Element>) => void,
  }) => ReactNode,
}) => {
  const firstRender = useRef(true)

  const [dragging, setDragging] = useState(false)
  const [dragDelta, setDragDelta] = useState({ x: 0, y: 0 })
  const [resizing, setResizing] = useState(false)
  const [resizeDelta, setResizeDelta] = useState({ x: 0, y: 0 })

  const [actualWidth, actualHeight] = useMemo(() => {
    if (!resizing) {
      return [width, height]
    }

    const actualWidth = width + resizeDelta.x
    const actualHeight = height + resizeDelta.y
    if (fixedAspectRatio) {
      const aspect = Math.max(actualWidth, actualHeight)
      return [aspect, aspect]
    } else {
      return [actualWidth, actualHeight]
    }
  }, [width, height, fixedAspectRatio, resizing, resizeDelta])

  const translate = useMemo(() => {
    const x = offsetX + (dragging ? dragDelta.x : 0)
    const y = offsetY + (dragging ? dragDelta.y : 0)
    return `${x}px ${y}px`
  }, [dragging, offsetX, offsetY, dragDelta])

  const onPointerDown = useCallback((event: React.PointerEvent<Element>) => {
    event.stopPropagation()
    event.preventDefault()
    event.nativeEvent.stopImmediatePropagation()
    if (dragDisabled) return
    onSelected()
    setDragging(true)
  }, [onSelected, setDragging, dragDisabled])

  const onWindowPointerMove = useCallback((event: PointerEvent) => {
    if (dragging) {
      setDragDelta((previous) => ({
        x: previous.x + event.movementX,
        y: previous.y + event.movementY,
      }))
    } else if (resizing) {
      setResizeDelta((previous) => ({
        x: previous.x + event.movementX,
        y: previous.y + event.movementY,
      }))
    }
  }, [
    dragging,
    resizing,
    setDragDelta,
    setResizeDelta,
  ])

  const onWindowPointerUp = useCallback(() => {
    flushSync(() => {
      setDragging(false)
      setResizing(false)
    })
  }, [setDragging, setResizing])

  const onResizeHandlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setResizing(true)
  }, [setResizing])

  useEffect(() => {
    if (resizing || firstRender.current) return
    if (resizeDelta.x === 0 && resizeDelta.y === 0) return
    const actualWidth = width + resizeDelta.x
    const actualHeight = height + resizeDelta.y
    if (fixedAspectRatio) {
      const aspect = Math.max(actualWidth, actualHeight)
      onResizeEnd({
        x: aspect,
        y: aspect,
      })
    } else {
      onResizeEnd({
        x: actualWidth,
        y: actualHeight,
      })
    }
  }, [resizing, onResizeEnd, fixedAspectRatio, resizeDelta, setResizeDelta])

  useEffect(() => {
    if (dragging || firstRender.current) return
    if (resizing) {
      document.documentElement.style.cursor = 'nwse-resize'
      window.addEventListener('pointermove', onWindowPointerMove)
      window.addEventListener('pointerup', onWindowPointerUp)
      return () => {
        document.documentElement.style.cursor = ''
        window.removeEventListener('pointermove', onWindowPointerMove)
        window.removeEventListener('pointerup', onWindowPointerUp)
      }
    } else if (firstRender.current) {
      firstRender.current = false
    } else {
      document.documentElement.style.cursor = ''
      setResizeDelta({ x: 0, y: 0 })
    }

    return () => { }
  }, [
    dragging,
    resizing,
    setResizing,
    setResizeDelta,
    onWindowPointerMove,
    onWindowPointerUp,
  ])

  useEffect(() => {
    if (dragging || firstRender.current) return
    if (dragDelta.x === 0 && dragDelta.y === 0) return
    onDragEnd({
      x: offsetX + dragDelta.x,
      y: offsetY + dragDelta.y,
    })
  }, [dragging, onDragEnd, dragDelta])

  useEffect(() => {
    if (resizing) return
    if (dragging) {
      window.addEventListener('pointermove', onWindowPointerMove, { capture: true })
      window.addEventListener('pointerup', onWindowPointerUp, { capture: true })
      document.documentElement.style.cursor = 'grabbing'
      return () => {
        document.documentElement.style.cursor = ''
        window.removeEventListener('pointermove', onWindowPointerMove, { capture: true })
        window.removeEventListener('pointerup', onWindowPointerUp, { capture: true })
      }
    } else if (firstRender.current) {
      firstRender.current = false
    } else {
      document.documentElement.style.cursor = ''
      setDragDelta({ x: 0, y: 0 })
    }

    return () => { }
  }, [
    resizing,
    dragging,
    setDragDelta,
    onWindowPointerMove,
    onWindowPointerUp,
    onDragEnd,
  ])

  const actualChildren = useMemo(() => {
    return children({ onPointerDown })
  }, [children, onPointerDown])

  return (
    <div
      className={clsx('absolute pointer-events-none', {
        'border border-blue-400': selected,
      })}
      style={{
        translate,
        width: actualWidth,
        height: actualHeight,
        cursor: dragging ? 'grabbing' : 'grab',
        willChange: 'width height',
        zIndex: layer,
      }}>
      {actualChildren}
      {selected && (
        <>
          <div
            onPointerDown={onResizeHandlePointerDown}
            style={{ cursor: 'nwse-resize ' }}
            className="pointer-events-auto -bottom-1.5 -right-1.5 absolute z-20 w-3 h-3 bg-white border border-blue-400" />
          <div
            className="pointer-events-auto absolute -top-14 h-10 flex text-white rounded-md bg-gray-900 divide-x divide-white"
            onPointerDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}>
            {actions}
          </div>
        </>
      )}
    </div>
  )
}

export default EditContainer
