import React, { useMemo } from 'react'
import { useRecoilCallback, useRecoilValue } from 'recoil'
import { stars$, objectSelected$ } from '../state'
import EditContainer from './edit_container'
import ColorPicker from './color_picker'
import { Point } from '../core'

const RenderStar = ({
  objectId,
}: {
  objectId: string,
}) => {
  const star = useRecoilValue(stars$(objectId))
  const starSelected = useRecoilValue(objectSelected$(objectId))

  const onFillChange = useRecoilCallback(({ set }) => (fill: string) => {
    set(stars$(objectId), (old) => ({ ...old, fill }))
  }, [objectId])

  const onMoveForward = useRecoilCallback(({ set }) => () => {
    set(stars$(objectId), (old) => ({ ...old, layer: old.layer + 1 }))
  }, [objectId])

  const onMoveBackward = useRecoilCallback(({ set }) => () => {
    set(stars$(objectId), (old) => {
      if (old.layer === 0) return old
      return { ...old, layer: old.layer - 1 }
    })
  }, [objectId])

  const onEditContainerSelected = useRecoilCallback(({ set }) => () => {
    set(objectSelected$(objectId), true)
  }, [objectId])

  const onEditContainerDragEnd = useRecoilCallback(({ set }) => (position: Point) => {
    set(stars$(objectId), (old) => ({ ...old, position }))
  }, [objectId])

  const onEditContainerResizeEnd = useRecoilCallback(({ set }) => (dimensions: Point) => {
    set(stars$(objectId), (old) => ({ ...old, size: Math.max(dimensions.x, dimensions.y) }))
  }, [objectId])

  const actions = useMemo(() => [
    <ColorPicker
      key="fill"
      value={star.fill}
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
  ], [star.fill, onFillChange])

  return (
    <EditContainer
      width={star.size}
      height={star.size}
      offsetX={star.position.x}
      offsetY={star.position.y}
      selected={starSelected}
      fixedAspectRatio={true}
      layer={star.layer}
      dragDisabled={false}
      onSelected={onEditContainerSelected}
      onResizeEnd={onEditContainerResizeEnd}
      onDragEnd={onEditContainerDragEnd}
      actions={actions}>
      {({ onPointerDown }) => (
        <svg
          className="absolute w-full h-full"
          viewBox="0 0 51 48">
          <path
            className="pointer-events-auto"
            d="m25,1 6,17h18l-14,11 5,17-15-10-15,10 5-17-14-11h18z"
            fill={star.fill}
            onPointerDown={onPointerDown} />
        </svg>
      )}
    </EditContainer>
  )
}

export default RenderStar
