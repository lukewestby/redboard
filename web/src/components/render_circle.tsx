import React, { useMemo } from 'react'
import { useRecoilCallback, useRecoilValue } from 'recoil'
import { circles$, objectSelected$ } from '../state'
import EditContainer from './edit_container'
import ColorPicker from './color_picker'
import { Point } from '../core'

const RenderCircle = ({
  objectId,
}: {
  objectId: string,
}) => {
  const circle = useRecoilValue(circles$(objectId))
  const circleSelected = useRecoilValue(objectSelected$(objectId))

  const onFillChange = useRecoilCallback(({ set }) => (fill: string) => {
    set(circles$(objectId), (old) => ({ ...old, fill }))
  }, [])

  const onMoveForward = useRecoilCallback(({ set }) => () => {
    set(circles$(objectId), (old) => ({ ...old, layer: old.layer + 1 }))
  }, [objectId])

  const onMoveBackward = useRecoilCallback(({ set }) => () => {
    set(circles$(objectId), (old) => {
      if (old.layer === 0) return old
      return { ...old, layer: old.layer - 1 }
    })
  }, [objectId])

  const onEditContainerSelected = useRecoilCallback(({ set }) => () => {
    set(objectSelected$(objectId), true)
  }, [objectId])

  const onEditContainerDragEnd = useRecoilCallback(({ set }) => (position: Point) => {
    set(circles$(objectId), (previous) => ({ ...previous, position }))
  }, [objectId])

  const onEditContainerResizeEnd = useRecoilCallback(({ set }) => (dimensions: Point) => {
    set(circles$(objectId), (previous) => ({ ...previous, radius: Math.max(dimensions.x, dimensions.y) / 2 }))
  }, [objectId])

  const actions = useMemo(() => [
    <ColorPicker
      key="fill"
      value={circle.fill}
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
  ], [circle.fill, onFillChange])

  return (
    <EditContainer
      width={circle.radius * 2}
      height={circle.radius * 2}
      offsetX={circle.position.x}
      offsetY={circle.position.y}
      selected={circleSelected}
      fixedAspectRatio={true}
      layer={circle.layer}
      dragDisabled={false}
      onSelected={onEditContainerSelected}
      onResizeEnd={onEditContainerResizeEnd}
      onDragEnd={onEditContainerDragEnd}
      actions={actions}>
      {({ onPointerDown }) => (
        <div
          onPointerDown={onPointerDown}
          className="w-full h-full rounded-full pointer-events-auto"
          style={{ backgroundColor: circle.fill }} />
      )}
    </EditContainer>
  )
}

export default RenderCircle
