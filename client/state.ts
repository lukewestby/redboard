import { atomFamily, selectorFamily, atom, RecoilLoadable, selector, noWait } from 'recoil'
import { syncEffect } from 'recoil-sync'
import { string, set, mixed, literal, or, dict, object, number, bool } from '@recoiljs/refine'
import { Point } from './core'

import.meta.hot && import.meta.hot.decline()

export type HeaderStyle =
  | 'Large'
  | 'Small'
export const headerStyle$ = atom<HeaderStyle>({
  key: 'HeaderStyle',
})

export const username$ = atom<string | null>({
  key: 'Username',
  default: null,
  effects: [
    syncEffect({ refine: or(string(), literal(null)), storeKey: 'LocalStorage' })
  ]
})

export const boardId$ = atom<string>({
  key: 'BoardId',
})

export const sessionId$ = atom<string | null>({
  key: 'SessionId',
  default: null,
  effects: [
    syncEffect({ refine: or(string(), literal(null)), storeKey: 'SessionStorage' }),
  ]
})

export const headerSessions$ = atom<Array<Session>>({
  key: 'HeaderSessions',
  default: [],
})

export const connected$ = atom<boolean>({
  key: 'Connected',
  default: false,
  effects: [
    syncEffect({ refine: bool(), storeKey: 'ConnectedProtocol' })
  ]
})

export const selectedObjectId$ = atom<string | null>({
  key: 'SelectedObjectId',
  default: null,
})

export const objectSelected$ = selectorFamily<boolean, string>({
  key: 'ObjectSelected',
  get: (objectId) => ({ get }) => {
    return get(selectedObjectId$) === objectId
  },
  set: (objectId) => ({ set }) => {
    set(selectedObjectId$, objectId)
  }
})

export const objectIds$ = atomFamily<ReadonlySet<string>, string>({
  key: 'ObjectIds',
  default: new Set(),
  effects: (boardId) => [
    syncEffect({
      refine: set(string()),
      itemKey: boardId,
      storeKey: 'ObjectIdsProtocol'
    })
  ]
})

export const objects$ = atomFamily<Record<string, any>, string>({
  key: 'Object',
  effects: (objectId) => [
    syncEffect({
      refine: dict(mixed()),
      itemKey: objectId,
      storeKey: 'ObjectProtocol',
    })
  ]
})

export type ObjectType =
  | Square['type']
  | Circle['type']
  | Star['type']
  | Triangle['type']
  | Textbox['type']
export const objectTypes$ = selectorFamily<ObjectType, string>({
  key: 'ObjectType',
  get: (objectId) => ({ get }) => get(objects$(objectId)).type ?? '__Unknown__',
})

export type Square = {
  type: 'Square',
  position: Point,
  fill: string,
  size: number,
  layer: number,
}
export const Square = {
  default: (): Square => ({
    type: 'Square',
    position: { x: 100, y: 100 },
    fill: '#777777',
    size: 100,
    layer: 0,
  })
}

export const squares$ = selectorFamily<Square, string>({
  key: 'Square',
  get: (objectId) => ({ get }) => {
    const object = get(objects$(objectId))
    return object.type === 'Square' ?
      RecoilLoadable.of(object as Square) :
      RecoilLoadable.error('Not a Square')
  },
  set: (objectId) => ({ set }, newValue) => {
    set(objects$(objectId), newValue)
  }
})

export type Circle = {
  type: 'Circle',
  position: Point,
  fill: string,
  radius: number,
  layer: number,
}
export const Circle = {
  default: (): Circle => ({
    type: 'Circle',
    position: { x: 100, y: 100 },
    fill: '#777777',
    radius: 50,
    layer: 0,
  })
}

export const circles$ = selectorFamily<Circle, string>({
  key: 'Circle',
  get: (objectId) => ({ get }) => {
    const object = get(objects$(objectId))
    return object.type === 'Circle' ?
      RecoilLoadable.of(object as Circle) :
      RecoilLoadable.error('Not a Circle')
  },
  set: (objectId) => ({ set }, newValue) => {
    set(objects$(objectId), newValue)
  }
})

export type Star = {
  type: 'Star',
  position: Point,
  fill: string,
  size: number,
  layer: number,
}
export const Star = {
  default: (): Star => ({
    type: 'Star' as const,
    position: { x: 200, y: 200 },
    fill: '#777777',
    size: 100,
    layer: 0,
  })
}

export const stars$ = selectorFamily<Star, string>({
  key: 'Star',
  get: (objectId) => ({ get }) => {
    const object = get(objects$(objectId))
    if (object.type === 'Star') return RecoilLoadable.of(object as Star)
    else return RecoilLoadable.error('Not a Star')
  },
  set: (objectId) => ({ set }, newValue) => {
    set(objects$(objectId), newValue)
  }
})

export type Triangle = {
  type: 'Triangle',
  position: Point,
  fill: string,
  size: number,
  layer: number,
}
export const Triangle = {
  default: (): Triangle => ({
    type: 'Triangle' as const,
    position: { x: 200, y: 200 },
    fill: '#777777',
    size: 100,
    layer: 0,
  })
}

export const triangles$ = selectorFamily<Triangle, string>({
  key: 'Triangle',
  get: (objectId) => ({ get }) => {
    const object = get(objects$(objectId))
    if (object.type === 'Triangle') return RecoilLoadable.of(object as Triangle)
    else return RecoilLoadable.error('Not a Triangle')
  },
  set: (objectId) => ({ set }, newValue) => {
    set(objects$(objectId), newValue)
  }
})

export type Textbox = {
  type: 'Textbox',
  position: Point,
  color: string,
  width: number,
  height: number,
  content: string,
  fontSize: number,
  layer: number,
}
export const Textbox = {
  default: (): Textbox => ({
    type: 'Textbox' as const,
    position: { x: 200, y: 200 },
    color: '#000000',
    width: 200,
    height: 100,
    content: 'Hello, Redis',
    fontSize: 16,
    layer: 0,
  })
}

export const textboxes$ = selectorFamily<Textbox, string>({
  key: 'Textbox',
  get: (objectId) => ({ get }) => {
    const object = get(objects$(objectId))
    return object.type === 'Textbox' ?
      RecoilLoadable.of(object as Textbox) :
      RecoilLoadable.error('Not a Textbox')
  },
  set: (objectId) => ({ set }, newValue) => {
    set(objects$(objectId), newValue)
  }
})

export type Session = {
  id: string,
  username: string,
  cursor: Point | null,
}

export const sessionIds$ = atom<ReadonlySet<string>>({
  key: 'SessionIds',
  default: new Set(),
  effects: [
    syncEffect({
      refine: set(string()),
      itemKey: 'sessions',
      storeKey: 'PresenceProtocol',
    })
  ]
})

export const sessions$ = selector<Array<Session>>({
  key: 'Sessions',
  get: ({ get }) => {
    const sessionIds = get(sessionIds$)
    const output = []
    for (const sessionId of sessionIds) {
      const username = get(noWait(usernames$(sessionId))).valueMaybe()
      const cursor = get(noWait(cursors$(sessionId))).valueMaybe()
      if (typeof username !== 'undefined' && typeof cursor !== 'undefined') {
        output.push({ id: sessionId, cursor, username })
      }
    }
    return output
  }
})

export const usernames$ = atomFamily<string, string>({
  key: 'Usernames',
  effects: (sessionId) => [
    syncEffect({
      refine: string(),
      itemKey: `usernames/${sessionId}`,
      storeKey: 'PresenceProtocol',
    })
  ]
})

export const cursors$ = atomFamily<Point | null, string>({
  key: 'Cursors',
  effects: (sessionId) => [
    syncEffect({
      refine: or(object({ x: number(), y: number() }), literal(null)),
      itemKey: `cursors/${sessionId}`,
      storeKey: 'PresenceProtocol',
    })
  ]
})
