import React, { useCallback } from 'react'
import { useRecoilState, useRecoilCallback, useRecoilValue } from 'recoil'
import { stars$, objectSelected$ } from '../state'
import { throttle } from 'throttle-debounce'
import EditContainer from './edit_container'
import { Point } from '../core'

const RenderStar = ({
  objectId,
}: {
  objectId: string,
}) => {
  const [star, setStar] = useRecoilState(stars$(objectId))
  const starSelected = useRecoilValue(objectSelected$(objectId))

  const onFillChangeThrottled = useCallback(throttle(100, (fill: string) => {
    setStar((old) => ({ ...old, fill }))
  }), [setStar])
  const onFillChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    onFillChangeThrottled(event.target.value)
  }, [onFillChangeThrottled])

  const onEditContainerSelected = useRecoilCallback(({ set }) => () => {
    set(objectSelected$(objectId), true)
  }, [objectId])

  const onEditContainerDragEnd = useRecoilCallback(({ set }) => (center: Point) => {
    set(stars$(objectId), (previous) => ({ ...previous, center }))
  }, [objectId])

  const onEditContainerResizeEnd = useRecoilCallback(({ set }) => (dimensions: Point) => {
    set(stars$(objectId), (previous) => ({ ...previous, size: Math.max(dimensions.x, dimensions.y) }))
  }, [objectId])

  return (
    <EditContainer
      width={star.size}
      height={star.size}
      offsetX={star.center.x}
      offsetY={star.center.y}
      selected={starSelected}
      fixedAspectRatio={true}
      layer={star.layer}
      dragDisabled={false}
      onSelected={onEditContainerSelected}
      onResizeEnd={onEditContainerResizeEnd}
      onDragEnd={onEditContainerDragEnd}>
      <div className="w-full h-full">
        {starSelected && (
          <div className="absolute -top-14 w-10 h-10 rounded-md bg-gray-900 p-2 overflow-hidden">
            <div
              className="border border-white rounded-full w-6 h-6 relative"
              style={{ backgroundColor: star.fill }}>
            </div>
            <input
              type="color"
              className="absolute h-8 w-8 block appearance-none top-2 left-2 bg-transparent cursor-pointer"
              value={star.fill}
              onChange={onFillChange} />
          </div>
        )}
        <svg
          className="absolute top-0 left-0 text-blue-400 w-full h-full"
          viewBox="0 0 51 48">
          <path d="m25,1 6,17h18l-14,11 5,17-15-10-15,10 5-17-14-11h18z" fill={starSelected ? "currentColor" : star.fill} />
        </svg>
        <svg
          className="absolute"
          style={{ width: 'calc(100% - 10px)', height: 'calc(100% - 10px)', top: 5, left: 5 }}
          viewBox="0 0 51 48">
          <path d="m25,1 6,17h18l-14,11 5,17-15-10-15,10 5-17-14-11h18z" fill={star.fill} />
        </svg>
      </div>
    </EditContainer>
  )
}

export default RenderStar
