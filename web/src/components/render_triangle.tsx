import React, { useMemo } from 'react'
import { useRecoilCallback, useRecoilValue } from 'recoil'
import { objectSelected$, triangles$ } from '../state'
import EditContainer from './edit_container'
import ColorPicker from './color_picker'
import { Point } from '../core'

const RenderTriangle = ({
  objectId,
}: {
  objectId: string,
}) => {
  const triangle = useRecoilValue(triangles$(objectId))
  const triangleSelected = useRecoilValue(objectSelected$(objectId))

  const onFillChange = useRecoilCallback(({ set }) => (fill: string) => {
    set(triangles$(objectId), (old) => ({ ...old, fill }))
  }, [objectId])

  const onMoveForward = useRecoilCallback(({ set }) => () => {
    set(triangles$(objectId), (old) => {
      return { ...old, layer: old.layer + 1 }
    })
  }, [objectId])

  const onMoveBackward = useRecoilCallback(({ set }) => () => {
    set(triangles$(objectId), (old) => {
      if (old.layer === 0) return old
      return { ...old, layer: old.layer - 1 }
    })
  }, [objectId])

  const onEditContainerSelected = useRecoilCallback(({ set }) => () => {
    set(objectSelected$(objectId), true)
  }, [objectId])

  const onEditContainerDragEnd = useRecoilCallback(({ set }) => (position: Point) => {
    set(triangles$(objectId), (old) => ({ ...old, position }))
  }, [objectId])

  const onEditContainerResizeEnd = useRecoilCallback(({ set }) => (dimensions: Point) => {
    set(triangles$(objectId), (old) => ({ ...old, size: Math.max(dimensions.x, dimensions.y) }))
  }, [objectId])

  const actions = useMemo(() => [
    <ColorPicker
      key="fill"
      value={triangle.fill}
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
  ], [triangle.fill, onFillChange])

  return (
    <EditContainer
      width={triangle.size}
      height={triangle.size}
      offsetX={triangle.position.x}
      offsetY={triangle.position.y}
      selected={triangleSelected}
      fixedAspectRatio={true}
      layer={triangle.layer}
      dragDisabled={false}
      onSelected={onEditContainerSelected}
      onResizeEnd={onEditContainerResizeEnd}
      onDragEnd={onEditContainerDragEnd}
      actions={actions}>
      {({ onPointerDown }) => (
        <svg className="absolute w-full h-full" viewBox="0 0 10 10">
          <polygon
            className="pointer-events-auto"
            onPointerDown={onPointerDown}
            points="0.5,9 5,1 9.5,9"
            fill={triangle.fill} />
        </svg>
      )}
    </EditContainer>
  )
}

export default RenderTriangle
