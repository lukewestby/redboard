import React, { PropsWithChildren, useCallback, useMemo, PointerEvent as ReactPointerEvent, useState, useEffect, useRef } from 'react'
import clsx from 'clsx'
import { Point } from '../core'
import { flushSync } from 'react-dom'

type CornerDirection =
  | 'NorthEast'
  | 'SouthEast'

type SideDirection =
  | 'North'
  | 'East'

const EditContainer = ({
  width,
  height,
  offsetX,
  offsetY,
  selected,
  fixedAspectRatio,
  layer,
  dragDisabled,
  onSelected,
  onDragEnd,
  onResizeEnd,
  children,
}: PropsWithChildren<{
  width: number,
  height: number,
  offsetX: number,
  offsetY: number,
  selected: boolean,
  fixedAspectRatio: boolean,
  layer: number,
  dragDisabled: boolean,
  onSelected: () => void,
  onDragEnd: (point: Point) => void,
  onResizeEnd: (point: Point) => void,
}>) => {
  const firstRender = useRef(true)

  const [dragging, setDragging] = useState(false)
  const [dragDelta, setDragDelta] = useState({ x: 0, y: 0 })
  const [handleDragging, setHandleDragging] = useState(false)
  const cornerDirection = useRef<CornerDirection | null>(null)
  const sideDirection = useRef<SideDirection | null>(null)
  const [resizeDelta, setResizeDelta] = useState({ x: 0, y: 0 })

  const [actualWidth, actualHeight] = useMemo(() => {
    if (!handleDragging) {
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
  }, [width, height, fixedAspectRatio, handleDragging, resizeDelta])

  const translate = useMemo(() => {
    const x = offsetX + (dragging ? dragDelta.x : 0)
    const y = offsetY + (dragging ? dragDelta.y : 0)
    return `${x}px ${y}px`
  }, [dragging, offsetX, offsetY, dragDelta])

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragDisabled) return
    onSelected()
    setDragging(true)
  }, [onSelected, setDragging, dragDisabled])

  const onWindowPointerMove = useCallback((event: PointerEvent) => {
    if (dragging) {
      setDragDelta((previous) => ({
        x: previous.x + (sideDirection.current === 'East' || sideDirection.current === null ? event.movementX : 0),
        y: previous.y + (sideDirection.current === 'North' || sideDirection.current === null ? event.movementY : 0),
      }))
    } else if (handleDragging) {
      setResizeDelta((previous) => ({
        x: previous.x + event.movementX,
        y: previous.y + event.movementY,
      }))
    }
  }, [
    dragging,
    handleDragging,
    setDragDelta,
    setResizeDelta,
  ])

  const onWindowPointerUp = useCallback((event: PointerEvent) => {
    flushSync(() => {
      setDragging(false)
      setHandleDragging(false)
    })
  }, [setDragging, setHandleDragging])

  const onCornerHandlePointerDown = useCallback((direction: CornerDirection) => (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setHandleDragging(true)
    cornerDirection.current = direction
  }, [setHandleDragging])
  const onNorthEastCornerHandlePointerDown = useMemo(() => onCornerHandlePointerDown('NorthEast'), [onCornerHandlePointerDown])
  const onSouthEastCornerHandlePointerDown = useMemo(() => onCornerHandlePointerDown('SouthEast'), [onCornerHandlePointerDown])

  const onSideHandlePointerDown = useCallback((direction: SideDirection) => (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setHandleDragging(true)
    sideDirection.current = direction
  }, [setHandleDragging])
  const onNorthSideHandlePointerDown = useMemo(() => onSideHandlePointerDown('North'), [onSideHandlePointerDown])
  const onEastSideHandlePointerDown = useMemo(() => onSideHandlePointerDown('East'), [onSideHandlePointerDown])

  useEffect(() => {
    if (handleDragging || firstRender.current) return
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
  }, [handleDragging, onResizeEnd, fixedAspectRatio, resizeDelta, setResizeDelta])

  useEffect(() => {
    if (dragging) return
    if (handleDragging) {
      if (cornerDirection.current === 'NorthEast') document.documentElement.style.cursor = 'nesw-resize'
      if (cornerDirection.current === 'SouthEast') document.documentElement.style.cursor = 'nwse-resize'
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
      sideDirection.current = null
      cornerDirection.current = null
      setResizeDelta({ x: 0, y: 0 })
    }

    return () => { }
  }, [
    dragging,
    handleDragging,
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
    if (handleDragging) return
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
    handleDragging,
    dragging,
    setDragDelta,
    onWindowPointerMove,
    onWindowPointerUp,
    onDragEnd,
  ])

  return (
    <div
      onPointerDown={onPointerDown}
      className={clsx('absolute', {
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
      {children}
      {selected && (
        <>
          <div
            onPointerDown={onNorthEastCornerHandlePointerDown}
            style={{ cursor: 'nesw-resize' }}
            className="-bottom-1 -left-1 absolute z-20 w-2 h-2 bg-white border border-blue-400" />
          <div
            onPointerDown={onSouthEastCornerHandlePointerDown}
            style={{ cursor: 'nwse-resize' }}
            className="-top-1 -left-1 absolute z-20 w-2 h-2 bg-white border border-blue-400" />
          <div
            onPointerDown={onNorthEastCornerHandlePointerDown}
            style={{ cursor: 'ne-resize' }}
            className="-top-1 -right-1 absolute z-20 w-2 h-2 bg-white border border-blue-400" />
          <div
            onPointerDown={onSouthEastCornerHandlePointerDown}
            style={{ cursor: 'nwse-resize ' }}
            className="-bottom-1 -right-1 absolute z-20 w-2 h-2 bg-white border border-blue-400" />
          <div
            onPointerDown={onNorthSideHandlePointerDown}
            style={{ cursor: 'ns-resize' }}
            className="h-2 w-full -top-1 left-0 absolute z-10" />
          <div
            onPointerDown={onEastSideHandlePointerDown}
            style={{ cursor: 'ew-resize' }}
            className="h-full w-2 -left-1 top-0 absolute z-10" />
          <div
            onPointerDown={onNorthSideHandlePointerDown}
            style={{ cursor: 'ns-resize' }}
            className="h-2 w-full -bottom-1 left-0 absolute z-10" />
          <div
            onPointerDown={onEastSideHandlePointerDown}
            style={{ cursor: 'ew-resize' }}
            className="h-full w-2 -right-1 top-0 absolute z-10" />
        </>
      )}
    </div>
  )
}

export default EditContainer
