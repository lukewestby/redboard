import React, { useMemo } from 'react'
import { useRecoilCallback, useRecoilValue } from 'recoil'
import { objectSelected$, squares$ } from '../state'
import ColorPicker from './color_picker'
import EditContainer from './edit_container'
import { Point } from '../core'

const RenderSquare = ({
  objectId,
}: {
  objectId: string,
}) => {
  const square = useRecoilValue(squares$(objectId))
  const squareSelected = useRecoilValue(objectSelected$(objectId))

  const onFillChange = useRecoilCallback(({ set }) => (fill: string) => {
    set(squares$(objectId), (old) => ({ ...old, fill }))
  }, [objectId])

  const onMoveForward = useRecoilCallback(({ set }) => () => {
    set(squares$(objectId), (old) => ({ ...old, layer: old.layer + 1 }))
  }, [objectId])

  const onMoveBackward = useRecoilCallback(({ set }) => () => {
    set(squares$(objectId), (old) => {
      if (old.layer === 0) return old
      return { ...old, layer: old.layer - 1 }
    })
  }, [objectId])

  const onEditContainerSelected = useRecoilCallback(({ set }) => () => {
    set(objectSelected$(objectId), true)
  }, [objectId])

  const onEditContainerDragEnd = useRecoilCallback(({ set }) => (position: Point) => {
    set(squares$(objectId), (previous) => ({ ...previous, position }))
  }, [objectId])

  const onEditContainerResizeEnd = useRecoilCallback(({ set }) => (dimensions: Point) => {
    set(squares$(objectId), (previous) => ({ ...previous, size: Math.max(dimensions.x, dimensions.y) }))
  }, [objectId])

  const actions = useMemo(() => [
    <ColorPicker
      key="fill"
      value={square.fill}
      onChange={onFillChange} />,
    <button
      key="move_forward"
      className="block p-2 h-full"
      onClick={onMoveForward}>
      <span className="material-symbols-outlined">flip_to_front</span>
    </button>,
    <button
      key="move_backward"
      className="block p-2 h-full"
      onClick={onMoveBackward}>
      <span className="material-symbols-outlined">flip_to_back</span>
    </button>,
  ], [square.fill, onFillChange])

  return (
    <EditContainer
      width={square.size}
      height={square.size}
      offsetX={square.position.x}
      offsetY={square.position.y}
      selected={squareSelected}
      fixedAspectRatio={true}
      layer={square.layer}
      dragDisabled={false}
      onSelected={onEditContainerSelected}
      onResizeEnd={onEditContainerResizeEnd}
      onDragEnd={onEditContainerDragEnd}
      actions={actions}>
      {({ onPointerDown, onPointerUp }) => (
        <div
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          className="absolute rounded-md cursor-grab h-full w-full pointer-events-auto"
          style={{ backgroundColor: square.fill }} />
      )}
    </EditContainer>
  )
}

export default RenderSquare
