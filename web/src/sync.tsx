import React, { useRef, useCallback, useEffect, PropsWithChildren } from 'react'
import { DefaultValue } from 'recoil'
import { ListenInterface, RecoilSync, WriteInterface } from 'recoil-sync'
import deepEqual from 'deep-equal'
import { useProtocol, JsonObject, Change } from './protocol'
import { Point } from './core'

export const BrowserStorageSync = ({
  storeKey,
  namespace,
  children,
  storage,
}: PropsWithChildren<{
  storeKey: string,
  namespace: string,
  storage: Storage,
}>) => {
  const read = useCallback((key: string) => {
    const serialized = storage.getItem(namespace + '/' + key)
    if (serialized === null) return new DefaultValue()
    return JSON.parse(serialized)
  }, [storage])

  const write = useCallback(({ diff }: WriteInterface) => {
    diff.forEach((value, key) => {
      const namespacedKey = namespace + '/' + key
      if (value instanceof DefaultValue) storage.removeItem(namespacedKey)
      else storage.setItem(namespacedKey, JSON.stringify(value))
    })
  }, [storage])

  const listen = useCallback(({ updateItem }: ListenInterface) => {
    const listener = (event: StorageEvent) => {
      if (event.key === null) return
      if (event.storageArea !== storage) return
      const namespacedKey = namespace + '/' + event.key
      if (event.newValue === null) updateItem(namespacedKey, new DefaultValue())
      else updateItem(namespacedKey, JSON.parse(event.newValue))
    }
    window.addEventListener('storage', listener)
    return () => window.removeEventListener('storage', listener)
  }, [storage])

  return (
    <RecoilSync
      storeKey={storeKey}
      read={read}
      write={write}
      listen={listen}>
      {children}
    </RecoilSync>
  )
}

export const ObjectProtocolSync = ({
  children,
  storeKey,
  boardId,
  sessionId,
  username,
}: PropsWithChildren<{
  storeKey: string,
  boardId: string,
  sessionId: string,
  username: string,
}>
) => {
  const streaming = useRef(false)
  const objects = useRef(new Map())
  const pendingObjects = useRef(new Map())
  const pendingChanges = useRef<Map<string, Array<Change>>>(new Map())
  const emitter = useRef(new EventTarget())

  useEffect(() => {
    objects.current.clear()
    pendingObjects.current.clear()
    pendingChanges.current.clear()
    streaming.current = false
  }, [boardId, sessionId])

  const pendChange = (change: Change) => {
    if (!pendingObjects.current.has(change.id)) {
      pendingObjects.current.set(change.id, objects.current.get(change.id) ?? null)
    }
    const current = pendingChanges.current.get(change.id) ?? []
    current.push(change)
    pendingChanges.current.set(change.id, current)
  }

  const unpendChange = (change: Change) => {
    const current = pendingChanges.current.get(change.id) ?? []
    const first = current[0]
    if (deepEqual(first, change)) {
      current.shift()
      if (current.length === 0) {
        pendingChanges.current.delete(change.id)
        pendingObjects.current.delete(change.id)
      } else {
        pendingChanges.current.set(change.id, current)
      }
      return true
    } else {
      return false
    }
  }

  const materializeChange = (change: Change) => {
    if (change.type === 'Delete') {
      objects.current.delete(change.id)
    } else if (change.type === 'Update') {
      const current = objects.current.get(change.id)
      if (!current) return
      objects.current.set(change.id, { ...current, [change.key]: change.value })
    } else if (change.type === 'Insert') {
      objects.current.set(change.id, change.object)
    }
  }

  const onChangeReceived = useCallback((change: Change, source: string) => {
    if (source === sessionId) {
      if (!unpendChange(change)) {
        materializeChange(change)
      }
    } else {
      if (pendingObjects.current.has(change.id)) {
        const pendingObject = pendingObjects.current.get(change.id) ?? null
        if (pendingObject === null) objects.current.delete(change.id)
        else objects.current.set(change.id, pendingObject)
      }
      materializeChange(change)
      const pending = pendingChanges.current.get(change.id) ?? []
      pending.forEach(materializeChange)
      if (change.type === 'Delete') {
        emitter.current.dispatchEvent(new CustomEvent('objectdeleted', { detail: { id: change.id } }))
      } else {
        const object = objects.current.get(change.id)
        if (!object) return
        emitter.current.dispatchEvent(new CustomEvent('objectchanged', { detail: { id: change.id, object } }))
      }
    }
  }, [sessionId])

  const onDisconnected = useCallback(() => {
    objects.current.clear()
    pendingObjects.current.clear()
    pendingChanges.current.clear()
    streaming.current = false
  }, [])

  const onStreamingStarted = useCallback(() => {
    streaming.current = true
  }, [])

  const {
    applyChange: applyChangeToBackend,
  } = useProtocol({
    boardId,
    sessionId,
    username,
    onChangeReceived,
    onDisconnected,
    onStreamingStarted,
  })

  const applyChange = useCallback((change: Change) => {
    materializeChange(change)
    pendChange(change)
    applyChangeToBackend(change)
  }, [materializeChange, pendChange, applyChangeToBackend])

  const read = useCallback((key: string) => {
    return objects.current.get(key) ?? new DefaultValue()
  }, [])

  const write = useCallback(({ diff }: WriteInterface) => {
    if (!streaming.current) {
      diff.forEach((_, id) => {
        emitter.current.dispatchEvent(new CustomEvent('objectreverted', { detail: id }))
      })
      return
    }

    diff.forEach((newValue, id) => {
      if (newValue instanceof DefaultValue && objects.current.has(id)) {
        applyChange({ type: 'Delete', id })
      } else if (!objects.current.has(id)) {
        applyChange({ type: 'Insert', id, object: newValue as JsonObject })
      } else {
        const current = objects.current.get(id)!
        const updated = newValue as Record<string, any>
        Object.keys(updated).forEach((key) => {
          if (deepEqual(current[key], updated[key])) return
          applyChange({ type: 'Update' as const, id, key, value: updated[key] })
        })
      }
    })
  }, [
    applyChange,
  ])

  const listen = useCallback(({ updateItem }: ListenInterface) => {
    const revertListener = (event: Event) => {
      const id = (event as CustomEvent).detail
      updateItem(id, objects.current.get(id) ?? new DefaultValue())
    }
    const updateListener = (event: Event) => {
      const change = (event as CustomEvent).detail
      updateItem(change.id, change.object)
    }
    const deleteListener = (event: Event) => {
      const change = (event as CustomEvent).detail
      updateItem(change.id, new DefaultValue())
    }

    emitter.current.addEventListener('objectreverted', revertListener)
    emitter.current.addEventListener('objectchanged', updateListener)
    emitter.current.addEventListener('objectdeleted', deleteListener)

    return () => {
      emitter.current.removeEventListener('objectreverted', revertListener)
      emitter.current.removeEventListener('objectchanged', updateListener)
      emitter.current.removeEventListener('objectdeleted', deleteListener)
    }
  }, [])

  return (
    <RecoilSync
      storeKey={storeKey}
      read={read}
      write={write}
      listen={listen}>
      {children}
    </RecoilSync>
  )
}

export const ObjectIdsProtocolSync = ({
  children,
  storeKey,
  boardId,
  sessionId,
  username,
}: PropsWithChildren<{
  storeKey: string,
  boardId: string,
  sessionId: string,
  username: string,
}>) => {
  const objectIds = useRef<Set<string>>(new Set())
  const emitter = useRef(new EventTarget())

  const onChangeReceived = useCallback((change: Change) => {
    switch (change.type) {
      case 'Insert': {
        objectIds.current.add(change.id)
        break
      }
      case 'Delete': {
        objectIds.current.delete(change.id)
      }
    }
    emitter.current.dispatchEvent(new CustomEvent('changed'))
  }, [])

  useProtocol({
    boardId,
    sessionId,
    username,
    onChangeReceived,
  })

  const read = useCallback((id: string) => {
    if (id === boardId) return new Set(objectIds.current)
    else return new DefaultValue()
  }, [boardId])

  const listen = useCallback(({ updateItem }: ListenInterface) => {
    const listener = () => {
      updateItem(boardId, new Set(objectIds.current))
    }
    emitter.current.addEventListener('changed', listener)
    return () => emitter.current.removeEventListener('changed', listener)
  }, [boardId])

  return (
    <RecoilSync
      storeKey={storeKey}
      read={read}
      listen={listen}>
      {children}
    </RecoilSync>
  )
}

export const PresenceProtocolSync = ({
  children,
  storeKey,
  boardId,
  sessionId,
  username,
}: PropsWithChildren<{
  storeKey: string,
  boardId: string,
  sessionId: string,
  username: string,
}>) => {
  const otherUsernames = useRef(new Map())
  const otherCursors = useRef(new Map())
  const myCursor = useRef<Point | null>(null)
  const emitter = useRef(new EventTarget())

  const {
    updateCursor,
    clearCursor,
  } = useProtocol({
    boardId,
    sessionId,
    username,
    onUserJoined: (sessionId, username) => {
      otherUsernames.current.set(sessionId, username)
      otherCursors.current.set(sessionId, null)
      emitter.current.dispatchEvent(new CustomEvent('usernamechanged', { detail: sessionId }))
      emitter.current.dispatchEvent(new CustomEvent('cursorchanged', { detail: sessionId }))
    },
    onUserLeft: (sessionId) => {
      otherUsernames.current.set(sessionId, username)
      otherCursors.current.delete(sessionId)
      emitter.current.dispatchEvent(new CustomEvent('usernamechanged', { detail: sessionId }))
      emitter.current.dispatchEvent(new CustomEvent('cursorchanged', { detail: sessionId }))
    },
    onUserCursorChanged: (sessionId, x, y) => {
      otherCursors.current.set(sessionId, { x, y })
      emitter.current.dispatchEvent(new CustomEvent('cursorchanged', { detail: sessionId }))
    },
    onUserCursorCleared(sessionId) {
      otherCursors.current.set(sessionId, null)
      emitter.current.dispatchEvent(new CustomEvent('cursorchanged', { detail: sessionId }))
    },
  })

  const read = useCallback((key: string) => {
    if (key === `cursors/${sessionId}`) return myCursor.current
    else if (key.startsWith('cursors/')) {
      const sessionId = key.replace('cursors/', '')
      if (!otherCursors.current.has(sessionId)) return new DefaultValue()
      else return otherCursors.current.get(sessionId) ?? null
    }
    else if (key === `usernames/${sessionId}`) return username
    else if (key.startsWith('usernames/')) return otherUsernames.current.get(key.replace('usernames/', '')) ?? new DefaultValue()
    else if (key === 'sessions') return new Set(otherUsernames.current.keys())
    else return new DefaultValue()
  }, [sessionId])

  const write = useCallback(({ diff }: WriteInterface) => {
    diff.forEach((value, key) => {
      if (key === `cursors/${sessionId}`) {
        myCursor.current = value instanceof DefaultValue ? null : value as Point
        myCursor.current === null ? clearCursor() : updateCursor(myCursor.current.x, myCursor.current.y)
      }
    })
  }, [sessionId])

  const listen = useCallback(({ updateItem }: ListenInterface) => {
    const usernameChangedHandler = (event: Event) => {
      const sessionId = (event as CustomEvent).detail as string
      updateItem(`usernames/${sessionId}`, otherUsernames.current.get(sessionId) ?? new DefaultValue())
      updateItem('sessions', new Set(otherUsernames.current.keys()))
    }
    const cursorChangedHandler = (event: Event) => {
      const sessionId = (event as CustomEvent).detail as string
      if (otherCursors.current.has(sessionId)) updateItem(`cursors/${sessionId}`, otherCursors.current.get(sessionId) ?? null)
      else updateItem(`cursors/${sessionId}`, new DefaultValue())
    }
    emitter.current.addEventListener('usernamechanged', usernameChangedHandler)
    emitter.current.addEventListener('cursorchanged', cursorChangedHandler)
    return () => {
      emitter.current.removeEventListener('usernamechanged', usernameChangedHandler)
      emitter.current.removeEventListener('cursorchanged', cursorChangedHandler)
    }
  }, [])

  return (
    <RecoilSync
      storeKey={storeKey}
      read={read}
      write={write}
      listen={listen}>
      {children}
    </RecoilSync>
  )
}

export const ConnectedProtocolSync = ({
  children,
  storeKey,
  boardId,
  sessionId,
  username,
}: PropsWithChildren<{
  storeKey: string,
  boardId: string,
  sessionId: string,
  username: string,
}>) => {
  const connected = useRef(false)
  const emitter = useRef(new EventTarget())
  const onDisconnected = useCallback(() => {
    connected.current = false
    emitter.current.dispatchEvent(new CustomEvent('changed'))
  }, [])
  const onStreamingStarted = useCallback(() => {
    connected.current = true
    emitter.current.dispatchEvent(new CustomEvent('changed'))
  }, [])

  useProtocol({
    boardId,
    sessionId,
    username,
    onDisconnected,
    onStreamingStarted,
  })

  const read = useCallback((key: string) => {
    if (key === 'Connected') return connected.current
    else return new DefaultValue()
  }, [])

  const write = useCallback(() => {
    emitter.current.dispatchEvent(new CustomEvent('changed'))
  }, [])

  const listen = useCallback(({ updateItem }: ListenInterface) => {
    const listener = () => {
      updateItem('Connected', connected.current)
    }
    emitter.current.addEventListener('changed', listener)
    return () => emitter.current.removeEventListener('changed', listener)
  }, [])

  return (
    <RecoilSync
      storeKey={storeKey}
      read={read}
      write={write}
      listen={listen}>
      {children}
    </RecoilSync>
  )
}
