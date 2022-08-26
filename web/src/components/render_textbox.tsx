import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useRecoilState, useRecoilValue, useRecoilCallback } from 'recoil'
import { textboxes$, objectSelected$ } from '../state'
import { throttle } from 'throttle-debounce'
import clsx from 'clsx'
import EditContainer from './edit_container'
import { Point } from '../core'

const RenderTextbox = ({
  objectId,
}: {
  objectId: string,
}) => {
  const [textbox, setTextbox] = useRecoilState(textboxes$(objectId))
  const textboxSelected = useRecoilValue(objectSelected$(objectId))
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [editing, setEditing] = useState(false)
  const [textboxContent, setTextboxContent] = useState(textbox.content)

  useEffect(() => {
    if (!textboxSelected) setEditing(false)
  }, [setEditing, textboxSelected])

  useEffect(() => {
    if (!editing) return
    textareaRef.current?.focus()

    const listener = (event: MouseEvent) => {
      event.stopPropagation()
      event.preventDefault()
      setEditing(false)
    }
    window.addEventListener('mousedown', listener)
    return () => window.removeEventListener('mousedown', listener)
  }, [editing])

  useEffect(() => {
    setTextboxContent(textbox.content)
  }, [textbox])

  const onColorChangeThrottled = useCallback(throttle(100, (color: string) => {
    setTextbox((old) => ({ ...old, color }))
  }), [setTextbox])
  const onColorChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    onColorChangeThrottled(event.target.value)
  }, [onColorChangeThrottled])

  const onContentChangeThrottled = useCallback(throttle(100, (content: string) => {
    setTextbox((old) => ({ ...old, content }))
  }), [setTextbox])
  const onContentChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setTextboxContent(event.target.value)
    onContentChangeThrottled(event.target.value)
  }, [setTextboxContent, onContentChangeThrottled])

  const onEditContainerSelected = useRecoilCallback(({ set }) => () => {
    set(objectSelected$(objectId), true)
  }, [objectId])

  const onEditContainerDragEnd = useRecoilCallback(({ set }) => (position: Point) => {
    set(textboxes$(objectId), (previous) => ({ ...previous, position }))
  }, [objectId])

  const onEditContainerResizeEnd = useRecoilCallback(({ set }) => (dimensions: Point) => {
    set(textboxes$(objectId), (previous) => ({ ...previous, width: dimensions.x, height: dimensions.y }))
  }, [objectId])

  return (
    <EditContainer
      width={textbox.width}
      height={textbox.height}
      offsetX={textbox.position.x}
      offsetY={textbox.position.y}
      selected={textboxSelected}
      fixedAspectRatio={false}
      layer={textbox.layer}
      dragDisabled={editing}
      onSelected={onEditContainerSelected}
      onResizeEnd={onEditContainerResizeEnd}
      onDragEnd={onEditContainerDragEnd}>
      <div className="absolute w-full h-full rounded-md cursor-grab border border-dashed border-gray-200">
        {textboxSelected && (
          <div className="absolute -top-14 h-10 rounded-md bg-gray-900 px-2 overflow-hidden flex divide-x divide-x-white">
            <div className="pr-2 py-2">
              <div
                className="border border-white rounded-full w-6 h-6 relative"
                style={{ backgroundColor: textbox.color }}>
              </div>
              <input
                type="color"
                className="absolute h-8 w-8 block appearance-none top-2 left-2 bg-transparent cursor-pointer"
                value={textbox.color}
                onChange={onColorChange} />
            </div>
            <div className="p-2">
              <button
                onClick={() => setTextbox((old) => ({ ...old, fontSize: old.fontSize + 2 }))}
                className="bg-transparent w-8 cursor-pointer text-white">
                <span className="material-symbols-outlined">text_increase</span>
              </button>
            </div>
            <div className="pl-2 py-2">
              <button
                onClick={() => setTextbox((old) => ({ ...old, fontSize: old.fontSize - 2 }))}
                className="bg-transparent w-8 cursor-pointer text-white">
                <span className="material-symbols-outlined">text_decrease</span>
              </button>
            </div>
          </div>
        )}
        <div
          className="h-full w-full p-1"
          onDoubleClick={() => setEditing(true)}
          onMouseDown={(event) => editing && event.stopPropagation()}>
          <textarea
            ref={textareaRef}
            onKeyUp={(event) => {
              editing && event.stopPropagation()
            }}
            onChange={onContentChange}
            readOnly={!editing}
            value={textboxContent}
            className={clsx('h-full w-full overflow-hidden resize-none outline-none bg-transparent', {
              'cursor-text': editing,
              'cursor-pointer': !editing,
            })}
            style={{
              fontSize: textbox.fontSize,
              color: textbox.color,
            }}>
          </textarea>
        </div>
      </div>
    </EditContainer>
  )
}

export default RenderTextbox
