import React, { useCallback } from 'react'
import { useRecoilCallback, useRecoilState, useRecoilValue } from 'recoil'
import { objectSelected$, squares$ } from '../state'
import { throttle } from 'throttle-debounce'
import EditContainer from './edit_container'
import { Point } from '../core'

const RenderSquare = ({
  objectId,
}: {
  objectId: string,
}) => {
  const [square, setSquare] = useRecoilState(squares$(objectId))
  const squareSelected = useRecoilValue(objectSelected$(objectId))

  const onFillChangeThrottled = useCallback(throttle(100, (fill: string) => {
    setSquare((old) => ({ ...old, fill }))
  }), [setSquare])
  const onFillChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    onFillChangeThrottled(event.target.value)
  }, [onFillChangeThrottled])

  const onEditContainerSelected = useRecoilCallback(({ set }) => () => {
    set(objectSelected$(objectId), true)
  }, [objectId])

  const onEditContainerDragEnd = useRecoilCallback(({ set }) => (position: Point) => {
    set(squares$(objectId), (previous) => ({ ...previous, position }))
  }, [objectId])

  const onEditContainerResizeEnd = useRecoilCallback(({ set }) => (dimensions: Point) => {
    set(squares$(objectId), (previous) => ({ ...previous, size: Math.max(dimensions.x, dimensions.y) }))
  }, [objectId])

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
      onDragEnd={onEditContainerDragEnd}>
      <div
        className="absolute rounded-md cursor-grab h-full w-full"
        style={{ backgroundColor: square.fill }}>
        {squareSelected && (
          <div className="relative bottom-14 w-10 h-10 rounded-md bg-gray-900 p-2 overflow-hidden">
            <div
              className="border border-white rounded-full w-6 h-6 relative"
              style={{ backgroundColor: square.fill }}>
            </div>
            <input
              type="color"
              className="absolute h-8 w-8 block appearance-none top-2 left-2 bg-transparent cursor-pointer"
              value={square.fill}
              onChange={onFillChange} />
          </div>
        )}
      </div>
    </EditContainer>
  )
}

export default RenderSquare
