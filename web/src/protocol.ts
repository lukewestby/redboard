import React from 'react'

export const useProtocol = ({
  boardId,
  sessionId,
  username,
  onObjectInserted,
  onObjectUpdated,
  onObjectDeleted,
  onUserJoined,
  onUserLeft,
  onUserCursorChanged,
  onUserCursorCleared,
}: {
  boardId: string,
  sessionId: string,
  username: string,
  onObjectInserted?: (id: string, object: JsonObject, source: string) => void,
  onObjectUpdated?: (id: string, key: string, value: Json, source: string) => void,
  onObjectDeleted?: (id: string, source: string) => void,
  onUserJoined?: (id: string, username: string) => void,
  onUserLeft?: (id: string) => void,
  onUserCursorChanged?: (id: string, x: number, y: number) => void,
  onUserCursorCleared?: (id: string) => void,
}): {
  insertObject: (id: string, object: JsonObject) => void,
  updateObject: (id: string, key: string, value: Json) => void,
  deleteObject: (id: string) => void,
  updateCursor: (x: number, y: number) => void,
  clearCursor: () => void,
} => {
  const instance = React.useMemo(() => {
    return Protocol.get(boardId, sessionId, username)
  }, [boardId, sessionId])

  React.useEffect(() => {
    const unsubInserted = onObjectInserted && instance.subscribe('objectinserted', ({ id, object, source }) => onObjectInserted?.(id, object, source))
    const unsubUpdated = onObjectUpdated && instance.subscribe('objectupdated', ({ id, key, value, source }) => onObjectUpdated?.(id, key, value, source))
    const unsubDeleted = onObjectDeleted && instance.subscribe('objectdeleted', ({ id, source }) => onObjectDeleted?.(id, source))
    const unsubUserJoined = onUserJoined && instance.subscribe('userjoined', ({ sessionId, username }) => onUserJoined?.(sessionId, username))
    const unsubUserLeft = onUserLeft && instance.subscribe('userleft', ({ sessionId }) => onUserLeft?.(sessionId))
    const unsubCursorChanged = onUserCursorChanged && instance.subscribe('usercursorchanged', ({ sessionId, x, y }) => onUserCursorChanged?.(sessionId, x, y))
    const unsubCursorCleared = onUserCursorCleared && instance.subscribe('usercursorleft', ({ sessionId }) => onUserCursorCleared?.(sessionId))

    return () => {
      unsubInserted?.()
      unsubUpdated?.()
      unsubDeleted?.()
      unsubUserJoined?.()
      unsubUserLeft?.()
      unsubCursorChanged?.()
      unsubCursorCleared?.()
    }
  }, [
    instance,
    onObjectInserted,
    onObjectUpdated,
    onObjectDeleted,
  ])

  return {
    insertObject: (id, object) => instance.insertObject(id, object),
    updateObject: (id, key, value) => instance.updateObject(id, key, value),
    deleteObject: (id) => instance.deleteObject(id),
    updateCursor: (x, y) => instance.updateCursor(x, y),
    clearCursor: () => instance.clearCursor(),
  }
}

export interface JsonObject extends Record<string, Json> { }
export interface JsonArray extends Array<Json> { }
export type Json =
  | null
  | string
  | number
  | boolean
  | JsonObject
  | JsonArray

type ProtocolState =
  | { type: 'Disconnected' }
  | { type: 'Starting' }
  | { type: 'Snapshotting', objects: Array<[string, Record<string, any>]> }
  | { type: 'Streaming' }

export type Change =
  | { type: 'Insert', id: string, object: JsonObject }
  | { type: 'Update', id: string, key: string, value: Json }
  | { type: 'Delete', id: string }

type ClientMessage =
  | { type: 'ClientReady', username: string }
  | { type: 'StartSnapshot' }
  | { type: 'ApplyChange', change: Change }
  | { type: 'CursorChanged', x: number, y: number }
  | { type: 'CursorLeft' }
  | { type: 'Ping' }

type ServerMessage =
  | { type: 'ServerReady' }
  | { type: 'SnapshotChunk', entries: Array<[string, JsonObject]> }
  | { type: 'SnapshotFinished', version: string | null }
  | { type: 'ChangeAccepted', change: Change, session_id: string }
  | { type: 'UserJoined', session_id: string, username: String }
  | { type: 'UserLeft', session_id: string }
  | { type: 'UserCursorChanged', session_id: string, x: number, y: number }
  | { type: 'UserCursorLeft', session_id: string }

class Protocol {
  _boardId: string
  _sessionId: string
  _username: string
  _websocket: WebSocket | null
  _state: ProtocolState
  _emitter: EventTarget
  _isDisposed: boolean
  _connecting: boolean
  _lastMessage: ServerMessage | null
  _pingInterval: number | null
  _working: boolean
  _workQueue: Array<ServerMessage | 'Connect' | 'Opened' | 'Closed'>

  private static _registry: Map<string, Protocol> = new Map()
  public static get(boardId: string, sessionId: string, username: string): Protocol {
    let current = this._registry.get(boardId + '|' + sessionId)
    if (!current) {
      current = new Protocol(boardId, sessionId, username)
      this._registry.set(boardId + '|' + sessionId, current)
    }
    return current
  }

  private constructor(boardId: string, sessionId: string, username: string) {
    this._boardId = boardId
    this._sessionId = sessionId
    this._username = username
    this._emitter = new EventTarget()
    this._state = { type: 'Disconnected' }
    this._isDisposed = false
    this._lastMessage = null
    this._pingInterval = null
    this._websocket = null
    this._connecting = false
    this._working = false
    this._workQueue = []
    this._pushWork('Connect')
  }

  public insertObject(id: string, object: JsonObject) {
    const change = { type: 'Insert' as const, id, object }
    this._send({ type: 'ApplyChange', change })
    this._emitter.dispatchEvent(new CustomEvent('objectinserted', {
      detail: { id, object, source: this._sessionId },
    }))
  }

  public updateObject(id: string, key: string, value: Json) {
    const change = { type: 'Update' as const, id, key, value }
    this._send({ type: 'ApplyChange', change })
    this._emitter.dispatchEvent(new CustomEvent('objectupdated', {
      detail: { id, key, value, source: this._sessionId },
    }))
  }

  public deleteObject(id: string) {
    const change = { type: 'Delete' as const, id }
    this._send({ type: 'ApplyChange', change })
    this._emitter.dispatchEvent(new CustomEvent('objectdeleted', {
      detail: { id, source: this._sessionId },
    }))
  }

  public updateCursor(x: number, y: number) {
    this._send({ type: 'CursorChanged', x, y })
  }

  public clearCursor() {
    this._send({ type: 'CursorLeft' })
  }

  public subscribe(key: string, callback: (data: any) => void): () => void {
    const listener = (event: Event) => {
      callback((event as CustomEvent).detail)
    }
    this._emitter.addEventListener(key, listener)
    return () => this._emitter.removeEventListener(key, listener)
  }

  private _pushWork(work: ServerMessage | 'Connect' | 'Opened' | 'Closed') {
    this._workQueue.push(work)
    if (this._working) return
    this._working = true
    setTimeout(this._doWork)
  }

  private _doWork = async () => {
    const nextItem = this._workQueue.shift()
    if (!nextItem) {
      this._working = false
      return
    }

    await this._step(nextItem)
    setTimeout(this._doWork)
  }

  private async _connect(): Promise<WebSocket> {
    while (true) {
      console.count('reconnecting')
      try {
        return await this._initializeSocket(this._boardId, this._sessionId)
      } catch {
        await this._wait(2000)
      }
    }
  }

  private _initializeSocket(boardId: string, sessionId: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://localhost:3001/board/${boardId}?session_id=${sessionId}`)
      socket.addEventListener('message', (event) => this._pushWork(JSON.parse(event.data) as ServerMessage))
      socket.addEventListener('open', () => resolve(socket))
      socket.addEventListener('close', () => this._pushWork('Closed'))
      socket.addEventListener('error', () => reject(), { once: true })
    })
  }

  private _step = async (message: ServerMessage | 'Connect' | 'Opened' | 'Closed') => {
    if (message === 'Connect') {
      this._websocket = await this._connect()
      this._pushWork('Opened')
      return
    }

    if (message === 'Closed') {
      this._websocket = null
      this._state = { type: 'Disconnected' }
      window.clearInterval(this._pingInterval ?? undefined)
      this._wait(2000)
      this._pushWork('Connect')
      return
    }

    if (!this._websocket) return

    if (message === 'Opened') {
      this._pingInterval = window.setInterval(this._ping, 20000)
      this._state = { type: 'Starting' }
      this._send({ type: 'ClientReady', username: this._username })
      return
    }

    if (message.type === 'UserJoined') {
      this._emitter.dispatchEvent(new CustomEvent('userjoined', {
        detail: {
          sessionId: message.session_id,
          username: message.username,
        }
      }))
      return
    }

    if (message.type === 'UserLeft') {
      this._emitter.dispatchEvent(new CustomEvent('userleft', {
        detail: { sessionId: message.session_id }
      }))
      return
    }

    if (message.type === 'UserCursorChanged') {
      this._emitter.dispatchEvent(new CustomEvent('usercursorchanged', {
        detail: {
          sessionId: message.session_id,
          x: message.x,
          y: message.y,
        }
      }))
      return
    }

    if (message.type === 'UserCursorLeft') {
      this._emitter.dispatchEvent(new CustomEvent('usercursorleft', {
        detail: { sessionId: message.session_id }
      }))
      return
    }

    if (this._state.type === 'Starting' && message.type === 'ServerReady') {
      this._send({ type: 'StartSnapshot' })
      this._state = { type: 'Snapshotting', objects: [] }
      return
    }

    if (this._state.type === 'Snapshotting' && message.type === 'SnapshotChunk') {
      this._state.objects = this._state.objects.concat(message.entries)
      return
    }

    if (this._state.type === 'Snapshotting' && message.type === 'SnapshotFinished') {
      this._state.objects.forEach(([id, object]) => {
        this._emitter.dispatchEvent(new CustomEvent('objectinserted', {
          detail: { id, object, source: this._sessionId }
        }))
      })
      this._state = { type: 'Streaming' }
    }

    if (this._state.type === 'Streaming' && message.type === 'ChangeAccepted') {
      if (message.change.type === 'Delete') {
        this._emitter.dispatchEvent(new CustomEvent('objectdeleted', {
          detail: { id: message.change.id, source: message.session_id }
        }))
      } else if (message.change.type === 'Update') {
        this._emitter.dispatchEvent(new CustomEvent('objectupdated', {
          detail: { id: message.change.id, key: message.change.key, value: message.change.value, source: message.session_id },
        }))
      } else if (message.change.type === 'Insert') {
        this._emitter.dispatchEvent(new CustomEvent('objectinserted', {
          detail: { id: message.change.id, object: message.change.object, source: message.session_id },
        }))
      }
    }
  }

  private _ping = () => {
    this._send({ type: 'Ping' })
  }

  private _send = (message: ClientMessage) => {
    if (!this._websocket) return
    if (this._websocket.readyState !== WebSocket.OPEN) return
    this._websocket.send(JSON.stringify(message))
  }

  private _wait = (milliseconds: number): Promise<void> => {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve()
      }, milliseconds)
    })
  }
}
