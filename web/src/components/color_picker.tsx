import React, { useCallback } from 'react'
import { throttle } from 'throttle-debounce'

const ColorPicker = ({
  value,
  onChange,
}: {
  value: string,
  onChange: (value: string) => void,
}) => {
  const onChangeThrottled = useCallback(throttle(100, (value: string) => {
    onChange(value)
  }), [onChange])

  const onChangeHandler = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    onChangeThrottled(event.target.value)
  }, [onChangeThrottled])

  return (
    <div className="p-2">
      <div
        className="border border-white rounded-full w-6 h-6 relative"
        style={{ backgroundColor: value }}>
      </div>
      <input
        type="color"
        className="absolute h-8 w-8 block appearance-none top-2 left-2 bg-transparent cursor-pointer"
        value={value}
        onChange={onChangeHandler} />
    </div>
  )
}

export default ColorPicker
