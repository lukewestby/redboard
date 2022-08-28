import React from 'react'

import.meta.hot && import.meta.hot.decline()

export const useProtocol = ({
  boardId,
  sessionId,
  username,
  onChangeReceived,
  onUserJoined,
  onUserLeft,
  onUserCursorChanged,
  onUserCursorCleared,
  onDisconnected,
  onStreamingStarted,
}: {
  boardId: string,
  sessionId: string,
  username: string,
  onChangeReceived?: (change: Change, sessionId: string) => void,
  onUserJoined?: (id: string, username: string) => void,
  onUserLeft?: (id: string) => void,
  onUserCursorChanged?: (id: string, x: number, y: number) => void,
  onUserCursorCleared?: (id: string) => void,
  onDisconnected?: () => void,
  onStreamingStarted?: () => void,
}): {
  applyChange: (change: Change) => void,
  updateCursor: (x: number, y: number) => void,
  clearCursor: () => void,
} => {
  const instance = React.useMemo(() => {
    return Protocol.get(boardId, sessionId, username)
  }, [boardId, sessionId])

  React.useEffect(() => {
    const unsubChangeReceived = onChangeReceived && instance.subscribe('changereceived', ({ change, source }) => onChangeReceived?.(change, source))
    const unsubUserJoined = onUserJoined && instance.subscribe('userjoined', ({ sessionId, username }) => onUserJoined?.(sessionId, username))
    const unsubUserLeft = onUserLeft && instance.subscribe('userleft', ({ sessionId }) => onUserLeft?.(sessionId))
    const unsubCursorChanged = onUserCursorChanged && instance.subscribe('usercursorchanged', ({ sessionId, x, y }) => onUserCursorChanged?.(sessionId, x, y))
    const unsubCursorCleared = onUserCursorCleared && instance.subscribe('usercursorleft', ({ sessionId }) => onUserCursorCleared?.(sessionId))
    const unsubDisconnected = onDisconnected && instance.subscribe('disconnected', onDisconnected)
    const unsubStreamingStarted = onStreamingStarted && instance.subscribe('streamingstarted', onStreamingStarted)
    return () => {
      unsubChangeReceived?.()
      unsubUserJoined?.()
      unsubUserLeft?.()
      unsubCursorChanged?.()
      unsubCursorCleared?.()
      unsubDisconnected?.()
      unsubStreamingStarted?.()
    }
  }, [
    instance,
    onChangeReceived,
    onUserJoined,
    onUserJoined,
    onUserCursorChanged,
    onUserCursorCleared,
    onDisconnected,
    onStreamingStarted,
  ])

  return {
    applyChange: (change) => instance.applyChange(change),
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

type Work =
  | ServerMessage
  | 'Connect'
  | 'Opened'
  | 'Closed'
  | 'Wait'

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
  _workQueue: Array<Work>

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

  public applyChange(change: Change) {
    this._send({ type: 'ApplyChange', change })
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

  private _pushWork(work: Work) {
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

  private _connect(): WebSocket {
    let closed = false
    const socket = new WebSocket(`ws://${location.host}/board/${this._boardId}?session_id=${this._sessionId}`)
    const closedListener = () => {
      if (closed) return
      closed = true
      this._pushWork('Closed')
    }
    const openedListener = () => {
      if (closed) return
      this._pushWork('Opened')
    }
    const messageListener = (event: MessageEvent) => {
      this._pushWork(JSON.parse(event.data) as ServerMessage)
    }
    socket.addEventListener('message', messageListener)
    socket.addEventListener('open', openedListener)
    socket.addEventListener('close', closedListener)
    socket.addEventListener('error', closedListener)
    return socket
  }

  private _step = async (message: Work) => {
    if (message === 'Wait') {
      if (this._state.type !== 'Disconnected') return
      await this._wait(2000)
      return
    }

    if (message === 'Connect') {
      if (this._state.type !== 'Disconnected') return
      this._websocket = this._connect()
      this._state = { type: 'Starting' }
      return
    }

    if (message === 'Closed') {
      this._websocket = null
      this._state = { type: 'Disconnected' }
      window.clearInterval(this._pingInterval ?? undefined)
      this._emitter.dispatchEvent(new CustomEvent('disconnected'))
      this._pushWork('Wait')
      this._pushWork('Connect')
      return
    }

    if (!this._websocket) return

    if (message === 'Opened') {
      this._pingInterval = window.setInterval(this._ping, 20000)
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
        this._emitter.dispatchEvent(new CustomEvent('changereceived', {
          detail: {
            change: { type: 'Insert', id, object },
            source: this._sessionId
          }
        }))
      })
      this._state = { type: 'Streaming' }
      this._emitter.dispatchEvent(new CustomEvent('streamingstarted'))
    }

    if (this._state.type === 'Streaming' && message.type === 'ChangeAccepted') {
      this._emitter.dispatchEvent(new CustomEvent('changereceived', {
        detail: {
          change: message.change,
          source: message.session_id,
        }
      }))
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
