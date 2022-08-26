import React, { useCallback } from 'react'
import { useRecoilState, useRecoilCallback } from 'recoil'
import { objectSelected$, triangles$ } from '../state'
import { throttle } from 'throttle-debounce'
import EditContainer from './edit_container'
import { Point } from '../core'

const RenderTriangle = ({
  objectId,
}: {
  objectId: string,
}) => {
  const [triangle, setTriangle] = useRecoilState(triangles$(objectId))
  const [triangleSelected, setTriangleSelected] = useRecoilState(objectSelected$(objectId))

  const onFillChangeThrottled = useCallback(throttle(100, (fill: string) => {
    setTriangle((old) => ({ ...old, fill }))
  }), [setTriangle])
  const onFillChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    onFillChangeThrottled(event.target.value)
  }, [onFillChangeThrottled])

  const onEditContainerSelected = useCallback(() => {
    setTriangleSelected(true)
  }, [setTriangleSelected])

  const onEditContainerDragEnd = useRecoilCallback(({ set }) => (center: Point) => {
    set(triangles$(objectId), (previous) => ({ ...previous, center }))
  }, [objectId])

  const onEditContainerResizeEnd = useRecoilCallback(({ set }) => (dimensions: Point) => {
    set(triangles$(objectId), (previous) => ({ ...previous, size: Math.max(dimensions.x, dimensions.y) }))
  }, [objectId])

  return (
    <EditContainer
      width={triangle.size}
      height={triangle.size}
      offsetX={triangle.center.x}
      offsetY={triangle.center.y}
      selected={triangleSelected}
      fixedAspectRatio={true}
      layer={triangle.layer}
      dragDisabled={false}
      onSelected={onEditContainerSelected}
      onResizeEnd={onEditContainerResizeEnd}
      onDragEnd={onEditContainerDragEnd}>
      <div
        onPointerDown={() => setTriangleSelected(true)}
        className="absolute rounded-md p-1 cursor-grab w-full h-full">
        {triangleSelected && (
          <div className="absolute -top-14 w-10 h-10 rounded-md bg-gray-900 p-2 overflow-hidden">
            <div
              className="border border-white rounded-full w-6 h-6 relative"
              style={{ backgroundColor: triangle.fill }}>
            </div>
            <input
              type="color"
              className="absolute h-8 w-8 block appearance-none top-2 left-2 bg-transparent cursor-pointer"
              value={triangle.fill}
              onChange={onFillChange} />
          </div>
        )}
        <svg className="w-full h-full" viewBox="0 0 10 10">
          <polygon
            points="1,8.5 5,1.5 9,8.5"
            fill={triangle.fill}
            strokeLinejoin="round"
            paintOrder="stroke" />
        </svg>
      </div>
    </EditContainer>
  )
}

export default RenderTriangle
