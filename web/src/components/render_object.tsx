
import React from 'react'
import { useRecoilValue } from 'recoil'
import { objectTypes$ } from '../state'
import RenderSquare from './render_square'
import RenderCircle from './render_circle'
import RenderStar from './render_star'
import RenderTriangle from './render_triangle'
import RenderTextbox from './render_textbox'

const RenderObject = ({
  objectId,
}: {
  objectId: string
}) => {
  const objectType = useRecoilValue(objectTypes$(objectId))

  let child = null
  switch (objectType) {
    case 'Square': {
      child = <RenderSquare objectId={objectId} />
      break
    }
    case 'Circle': {
      child = <RenderCircle objectId={objectId} />
      break
    }
    case 'Star': {
      child = <RenderStar objectId={objectId} />
      break
    }
    case 'Triangle': {
      child = <RenderTriangle objectId={objectId} />
      break
    }
    case 'Textbox': {
      child = <RenderTextbox objectId={objectId} />
      break
    }
  }

  if (child === null) return null

  return (
    <div onClick={(event) => event.stopPropagation()}>
      {child}
    </div>
  )
}

export default RenderObject
