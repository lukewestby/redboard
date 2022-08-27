import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useRecoilState, useRecoilValue, useRecoilCallback } from 'recoil'
import { textboxes$, objectSelected$ } from '../state'
import { throttle } from 'throttle-debounce'
import EditContainer from './edit_container'
import ColorPicker from './color_picker'
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
    window.addEventListener('pointerdown', listener)
    return () => window.removeEventListener('pointerdown', listener)
  }, [editing])

  useEffect(() => {
    setTextboxContent(textbox.content)
  }, [textbox])

  const onColorChange = useRecoilCallback(({ set }) => (color: string) => {
    set(textboxes$(objectId), (old) => ({ ...old, color }))
  }, [objectId])

  const onIncreaseFontSize = useRecoilCallback(({ set }) => () => {
    set(textboxes$(objectId), (old) => ({ ...old, fontSize: old.fontSize + 2 }))
  }, [objectId])

  const onDecreaseFontSize = useRecoilCallback(({ set }) => () => {
    set(textboxes$(objectId), (old) => ({ ...old, fontSize: old.fontSize - 2 }))
  }, [objectId])

  const onMoveForward = useRecoilCallback(({ set }) => () => {
    set(textboxes$(objectId), (old) => ({ ...old, layer: old.layer + 1 }))
  }, [objectId])

  const onMoveBackward = useRecoilCallback(({ set }) => () => {
    set(textboxes$(objectId), (old) => {
      if (old.layer === 0) return old
      return { ...old, layer: old.layer - 1 }
    })
  }, [objectId])

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

  const actions = useMemo(() => [
    <ColorPicker
      key="color"
      value={textbox.color}
      onChange={onColorChange}
    />,
    <button
      key="font_increase"
      onClick={onIncreaseFontSize}
      className="block p-2 h-full cursor-pointer text-white">
      <span className="material-symbols-outlined">text_increase</span>
    </button>,
    <button
      key="font_decrease"
      onClick={onDecreaseFontSize}
      className="block p-2 h-full cursor-pointer text-white ">
      <span className="material-symbols-outlined">text_decrease</span>
    </button>,
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
    </button>
  ], [textbox.color, onColorChange])

  const renderChildren = useCallback(({
    onPointerDown,
  }: {
    onPointerDown: (event: React.PointerEvent<Element>) => void,
  }) => (
    <textarea
      onDoubleClick={() => setEditing(true)}
      onPointerDown={(event) => {
        console.log(editing)
        if (editing) event.stopPropagation()
        else onPointerDown(event)
      }}
      ref={textareaRef}
      onKeyUp={(event) => {
        editing && event.stopPropagation()
      }}
      onChange={onContentChange}
      readOnly={!editing}
      value={textboxContent}
      className="pointer-events-auto p-2 h-full w-full overflow-hidden resize-none outline-none bg-transparent absolute rounded-md cursor-grab border border-dashed border-gray-200 p1"
      style={{
        fontSize: textbox.fontSize,
        color: textbox.color,
        cursor: editing ? 'text' : 'grab',
        userSelect: editing ? 'none' : 'auto',
      }} />
  ), [setEditing, editing, textboxContent, onContentChange, textbox.fontSize, textbox.color])

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
      onDragEnd={onEditContainerDragEnd}
      actions={actions}>
      {renderChildren}
    </EditContainer>
  )
}

export default RenderTextbox
