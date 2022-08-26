import clsx from 'clsx'
import React, { useCallback } from 'react'
import { useRecoilCallback, useRecoilState, useRecoilValue } from 'recoil'
import { circles$, maxLayer$, objectSelected$ } from '../state'
import { throttle } from 'throttle-debounce'
import EditContainer from './edit_container'
import { Point } from '../core'

const RenderCircle = ({
  objectId,
}: {
  objectId: string,
}) => {
  const [circle, setCircle] = useRecoilState(circles$(objectId))
  const [circleSelected, setCircleSelected] = useRecoilState(objectSelected$(objectId))
  const maxLayer = useRecoilValue(maxLayer$)

  const onFillChangeThrottled = useCallback(throttle(100, (fill: string) => {
    setCircle((old) => ({ ...old, fill }))
  }), [setCircle])
  const onFillChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    onFillChangeThrottled(event.target.value)
  }, [onFillChangeThrottled])

  const onMoveForward = useRecoilCallback(({ set }) => () => {
    set(circles$(objectId), (old) => {
      return { ...old, layer: old.layer + 1 }
    })
  }, [objectId, maxLayer])
  const onMoveBackward = useRecoilCallback(({ set }) => () => {
    set(circles$(objectId), (old) => {
      if (old.layer === 0) return old
      return { ...old, layer: old.layer - 1 }
    })
  }, [objectId, maxLayer])

  const onEditContainerSelected = useCallback(() => {
    setCircleSelected(true)
  }, [setCircleSelected])

  const onEditContainerDragEnd = useRecoilCallback(({ set }) => (center: Point) => {
    set(circles$(objectId), (previous) => ({ ...previous, center }))
  }, [objectId])

  const onEditContainerResizeEnd = useRecoilCallback(({ set }) => (dimensions: Point) => {
    set(circles$(objectId), (previous) => ({ ...previous, radius: Math.max(dimensions.x, dimensions.y) / 2 }))
  }, [objectId])

  return (
    <EditContainer
      width={circle.radius * 2}
      height={circle.radius * 2}
      offsetX={circle.center.x}
      offsetY={circle.center.y}
      selected={circleSelected}
      fixedAspectRatio={true}
      layer={circle.layer}
      dragDisabled={false}
      onSelected={onEditContainerSelected}
      onResizeEnd={onEditContainerResizeEnd}
      onDragEnd={onEditContainerDragEnd}>
      <div
        className={clsx('w-full h-full rounded-full', {
          'border border-blue-400': circleSelected,
        })}
        style={{ backgroundColor: circle.fill }}>
        {circleSelected && (
          <div className="absolute -top-14 h-10 flex text-white rounded-md bg-gray-900 divide-x divide-white">
            <div className="p-2">
              <div
                className="border border-white rounded-full w-6 h-6 relative"
                style={{ backgroundColor: circle.fill }}>
              </div>
              <input
                type="color"
                className="absolute h-8 w-8 block appearance-none top-2 left-2 bg-transparent cursor-pointer"
                value={circle.fill}
                onChange={onFillChange} />
            </div>
            <button className="block p-2 h-full" onClick={onMoveForward}>
              <span className="material-symbols-outlined">flip_to_front</span>
            </button>
            <button className="block p-2 h-full" onClick={onMoveBackward}>
              <span className="material-symbols-outlined">flip_to_back</span>
            </button>
          </div>
        )}
      </div>
    </EditContainer>
  )
}

export default RenderCircle
