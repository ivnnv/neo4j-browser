/*
 * Copyright (c) 2002-2020 "Neo4j,"
 * Neo4j Sweden AB [http://neo4j.com]
 *
 * This file is part of Neo4j.
 *
 * Neo4j is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

import Rx from 'rxjs/Rx'
import bolt from 'services/bolt/bolt'
import { NO_AUTH } from 'services/bolt/boltHelpers'
import * as discovery from 'shared/modules/discovery/discoveryDuck'
import {
  fetchMetaData,
  CLEAR as CLEAR_META
} from 'shared/modules/dbMeta/dbMetaDuck'
import { executeSystemCommand } from 'shared/modules/commands/commandsDuck'
import {
  getInitCmd,
  getPlayImplicitInitCommands,
  getConnectionTimeout
} from 'shared/modules/settings/settingsDuck'
import { inWebEnv, USER_CLEAR, APP_START } from 'shared/modules/app/appDuck'

export const NAME = 'connections'
export const SET_ACTIVE = 'connections/SET_ACTIVE'
export const SELECT = 'connections/SELECT'
export const REMOVE = 'connections/REMOVE'
export const MERGE = 'connections/MERGE'
export const CONNECT = 'connections/CONNECT'
export const DISCONNECT = 'connections/DISCONNECT'
export const SILENT_DISCONNECT = 'connections/SILENT_DISCONNECT'
export const STARTUP_CONNECTION_SUCCESS =
  'connections/STARTUP_CONNECTION_SUCCESS'
export const STARTUP_CONNECTION_FAILED = 'connections/STARTUP_CONNECTION_FAILED'
export const CONNECTION_SUCCESS = 'connections/CONNECTION_SUCCESS'
export const DISCONNECTION_SUCCESS = 'connections/DISCONNECTION_SUCCESS'
export const LOST_CONNECTION = 'connections/LOST_CONNECTION'
export const UPDATE_CONNECTION_STATE = 'connections/UPDATE_CONNECTION_STATE'
export const UPDATE_RETAIN_CREDENTIALS = `${NAME}/UPDATE_RETAIN_CREDENTIALS`
export const UPDATE_AUTH_ENABLED = `${NAME}/UPDATE_AUTH_ENABLED`
export const SWITCH_CONNECTION = `${NAME}/SWITCH_CONNECTION`
export const SWITCH_CONNECTION_SUCCESS = `${NAME}/SWITCH_CONNECTION_SUCCESS`
export const SWITCH_CONNECTION_FAILED = `${NAME}/SWITCH_CONNECTION_FAILED`
export const INITIAL_SWITCH_CONNECTION_FAILED = `${NAME}/INITIAL_SWITCH_CONNECTION_FAILED`
export const VERIFY_CREDENTIALS = `${NAME}/VERIFY_CREDENTIALS`
export const USE_DB = `${NAME}/USE_DB`

export const DISCONNECTED_STATE = 0
export const CONNECTED_STATE = 1
export const PENDING_STATE = 2
export const CONNECTING_STATE = 3

const initialState = {
  allConnectionIds: [],
  connectionsById: {},
  activeConnection: null,
  connectionState: DISCONNECTED_STATE,
  lastUpdate: 0,
  useDb: null
}

/**
 * Selectors
 */
export function getConnection(state: any, id: any) {
  return (
    getConnections(state).find(
      connection => connection && connection.id === id
    ) || null
  )
}

export function getUseDb(state: any) {
  return (state[NAME] || {}).useDb
}

export function getConnections(state: any): any[] {
  return Object.values(state[NAME].connectionsById)
}

export function getConnectionState(state: any) {
  return state[NAME].connectionState || initialState.connectionState
}

export function getLastConnectionUpdate(state: any) {
  return state[NAME].lastUpdate || initialState.lastUpdate
}

export function isConnected(state: any) {
  return getConnectionState(state) === CONNECTED_STATE
}

export function getActiveConnection(state: any) {
  return state[NAME].activeConnection || initialState.activeConnection
}

export function getActiveConnectionData(state: any) {
  if (!state[NAME].activeConnection) return null
  return getConnectionData(state, state[NAME].activeConnection)
}

export function getAuthEnabled(state: any) {
  if (!state[NAME].activeConnection) return null
  const data = getConnectionData(state, state[NAME].activeConnection)
  return data.authEnabled
}

export function getConnectionData(state: any, id: any) {
  if (typeof state[NAME].connectionsById[id] === 'undefined') return null
  const data = state[NAME].connectionsById[id]
  data.db = getUseDb(state)
  if (data.username && data.password) return data
  if (!(data.username && data.password) && memoryUsername && memoryPassword) {
    // No retain state
    return { ...data, username: memoryUsername, password: memoryPassword }
  }
  return data
}

const addConnectionHelper = (state: any, obj: any) => {
  const connectionsById = { ...state.connectionsById, [obj.id]: obj }
  let allConnectionIds = state.allConnectionIds
  if (state.allConnectionIds.indexOf(obj.id) < 0) {
    allConnectionIds = state.allConnectionIds.concat([obj.id])
  }
  return {
    ...state,
    allConnectionIds,
    connectionsById
  }
}

const removeConnectionHelper = (state: any, connectionId: any) => {
  const connectionsById = { ...state.connectionsById }
  const allConnectionIds = state.allConnectionIds
  const index = allConnectionIds.indexOf(connectionId)
  if (index > 0) {
    allConnectionIds.splice(index, 1)
    delete connectionsById[connectionId]
  }
  return {
    ...state,
    allConnectionIds,
    connectionsById
  }
}

const mergeConnectionHelper = (state: any, connection: any) => {
  const { connectionsById, allConnectionIds } = state
  const { id } = connection
  return {
    ...state,
    connectionsById: {
      ...connectionsById,
      [id]: { ...connectionsById[id], ...connection }
    },
    allConnectionIds: allConnectionIds.includes(id)
      ? allConnectionIds
      : [...allConnectionIds, id]
  }
}

const updateAuthEnabledHelper = (state: any, authEnabled: any) => {
  const connectionId = state.activeConnection
  const updatedConnection = {
    ...state.connectionsById[connectionId],
    authEnabled
  }

  if (!authEnabled) {
    updatedConnection.username = ''
    updatedConnection.password = ''
  }

  const updatedConnectionByIds = {
    ...state.connectionsById
  }
  updatedConnectionByIds[connectionId] = updatedConnection

  return {
    ...state,
    connectionsById: updatedConnectionByIds
  }
}

// Local vars
let memoryUsername = ''
let memoryPassword = ''

// Reducer
export default function(state = initialState, action: any) {
  switch (action.type) {
    case APP_START:
      return {
        ...initialState,
        ...state,
        useDb: initialState.useDb,
        connectionState: DISCONNECTED_STATE
      }
    case SET_ACTIVE:
      let cState = CONNECTED_STATE
      if (!action.connectionId) cState = DISCONNECTED_STATE
      return {
        ...state,
        activeConnection: action.connectionId,
        connectionState: cState,
        lastUpdate: Date.now()
      }
    case CONNECT:
      return {
        ...state,
        connectionState: CONNECTING_STATE,
        lastUpdate: Date.now()
      }
    case REMOVE:
      return removeConnectionHelper(state, action.connectionId)
    case MERGE:
      return mergeConnectionHelper(state, action.connection)
    case UPDATE_CONNECTION_STATE:
      return {
        ...state,
        connectionState: action.state,
        lastUpdate: Date.now()
      }
    case UPDATE_AUTH_ENABLED:
      return updateAuthEnabledHelper(state, action.authEnabled)
    case USE_DB:
      return { ...state, useDb: action.useDb }
    case USER_CLEAR:
      return initialState
    default:
      return state
  }
}

// Actions
export const selectConnection = (id: any) => {
  return {
    type: SELECT,
    connectionId: id
  }
}

export const setActiveConnection = (id: any, silent = false) => {
  return {
    type: SET_ACTIVE,
    connectionId: id,
    silent
  }
}
export const updateConnection = (connection: any) => {
  return {
    type: MERGE,
    connection
  }
}

export const disconnectAction = (id = discovery.CONNECTION_ID) => {
  return {
    type: DISCONNECT,
    id
  }
}

export const updateConnectionState = (state: any) => ({
  state,
  type: UPDATE_CONNECTION_STATE
})

export const onLostConnection = (dispatch: any) => (e: any) => {
  dispatch({ type: LOST_CONNECTION, error: e })
}

export const connectionLossFilter = (action: any) => {
  const notLostCodes = [
    'Neo.ClientError.Security.Unauthorized',
    'Neo.ClientError.Security.AuthenticationRateLimit'
  ]
  return notLostCodes.indexOf(action.error.code) < 0
}

export const setRetainCredentials = (shouldRetain: any) => {
  return {
    type: UPDATE_RETAIN_CREDENTIALS,
    shouldRetain
  }
}

export const setAuthEnabled = (authEnabled: any) => {
  return {
    type: UPDATE_AUTH_ENABLED,
    authEnabled
  }
}

export const useDb = (db: any = null) => ({ type: USE_DB, useDb: db })

// Epics
export const useDbEpic = (action$: any) => {
  return action$
    .ofType(USE_DB)
    .do((action: any) => {
      bolt.useDb(action.useDb)
    })
    .map((action: any) => {
      if (!action.useDb) {
        return { type: 'NOOP' }
      }
      return fetchMetaData()
    })
}

export const connectEpic = (action$: any, store: any) => {
  return action$.ofType(CONNECT).mergeMap(async (action: any) => {
    if (!action.$$responseChannel) return Rx.Observable.of(null)
    memoryUsername = ''
    memoryPassword = ''
    bolt.closeConnection()
    await new Promise(resolve => setTimeout(() => resolve(), 2000))
    return bolt
      .openConnection(action, {
        connectionTimeout: getConnectionTimeout(store.getState())
      })
      .then(() => {
        if (action.requestedUseDb) {
          store.dispatch(
            updateConnection({
              id: action.id,
              requestedUseDb: action.requestedUseDb
            })
          )
        }
        return {
          type: action.$$responseChannel,
          success: true
        }
      })
      .catch(e => {
        if (!action.noResetConnectionOnFail) {
          store.dispatch(setActiveConnection(null))
        }
        return {
          type: action.$$responseChannel,
          success: false,
          error: e
        }
      })
  })
}

export const verifyConnectionCredentialsEpic = (action$: any) => {
  return action$.ofType(VERIFY_CREDENTIALS).mergeMap((action: any) => {
    if (!action.$$responseChannel) return Rx.Observable.of(null)
    return bolt
      .directConnect(action, {}, undefined)
      .then(driver => {
        driver.close()
        return { type: action.$$responseChannel, success: true }
      })
      .catch(e => {
        return { type: action.$$responseChannel, success: false, error: e }
      })
  })
}

export const startupConnectEpic = (action$: any, store: any) => {
  return action$
    .ofType(discovery.DONE)
    .do(() => store.dispatch(useDb(null))) // reset db to use
    .mergeMap(() => {
      const connection = getConnection(
        store.getState(),
        discovery.CONNECTION_ID
      )

      // No creds stored, fail auto-connect
      if (
        !connection ||
        connection.authenticationMethod === NO_AUTH ||
        !(connection.host && connection.username && connection.password)
      ) {
        store.dispatch(setActiveConnection(null))
        store.dispatch(discovery.updateDiscoveryConnection({ password: '' }))
        return Promise.resolve({ type: STARTUP_CONNECTION_FAILED })
      }
      return new Promise(resolve => {
        // Try to connect with stored creds
        bolt
          .openConnection(
            connection,
            {
              connectionTimeout: getConnectionTimeout(store.getState())
            },
            onLostConnection(store.dispatch)
          )
          .then(() => {
            store.dispatch(setActiveConnection(discovery.CONNECTION_ID))
            resolve({ type: STARTUP_CONNECTION_SUCCESS })
          })
          .catch(() => {
            store.dispatch(setActiveConnection(null))
            store.dispatch(
              discovery.updateDiscoveryConnection({
                username: '',
                password: ''
              })
            )
            resolve({ type: STARTUP_CONNECTION_FAILED })
          })
      })
    })
}

export const startupConnectionSuccessEpic = (action$: any, store: any) => {
  return action$
    .ofType(STARTUP_CONNECTION_SUCCESS)
    .do(() => {
      if (getPlayImplicitInitCommands(store.getState())) {
        store.dispatch(executeSystemCommand(`:server status`))
        store.dispatch(executeSystemCommand(getInitCmd(store.getState())))
      }
    })
    .mapTo({ type: 'NOOP' })
}
export const startupConnectionFailEpic = (action$: any, store: any) => {
  return action$
    .ofType(STARTUP_CONNECTION_FAILED)
    .do(() => {
      if (getPlayImplicitInitCommands(store.getState())) {
        store.dispatch(executeSystemCommand(`:server connect`))
      }
    })
    .mapTo({ type: 'NOOP' })
}

let lastActiveConnectionId: any = null
export const detectActiveConnectionChangeEpic = (action$: any) => {
  return action$.ofType(SET_ACTIVE).mergeMap((action: any) => {
    if (lastActiveConnectionId === action.connectionId) {
      return Rx.Observable.never()
    } // no change
    lastActiveConnectionId = action.connectionId
    if (!action.connectionId && !action.silent) {
      // Non silent disconnect
      return Rx.Observable.of({ type: DISCONNECTION_SUCCESS })
    } else if (!action.connectionId && action.silent) {
      // Silent disconnect
      return Rx.Observable.never()
    }
    return Rx.Observable.of({ type: CONNECTION_SUCCESS }) // connect
  })
}
export const disconnectEpic = (action$: any, store: any) => {
  return action$
    .ofType(DISCONNECT)
    .merge(action$.ofType(USER_CLEAR))
    .do(() => bolt.closeConnection())
    .do(() => store.dispatch(useDb(null)))
    .do((action: any) =>
      store.dispatch(updateConnection({ id: action.id, password: '' }))
    )
    .map(() => setActiveConnection(null))
}
export const silentDisconnectEpic = (action$: any, store: any) => {
  return action$
    .ofType(SILENT_DISCONNECT)
    .do(() => bolt.closeConnection())
    .do(() => store.dispatch(useDb(null)))
    .do(() => store.dispatch({ type: CLEAR_META }))
    .mapTo(setActiveConnection(null, true))
}
export const disconnectSuccessEpic = (action$: any) => {
  return action$
    .ofType(DISCONNECTION_SUCCESS)
    .mapTo(executeSystemCommand(':server connect'))
}
export const connectionLostEpic = (action$: any, store: any) =>
  action$
    .ofType(LOST_CONNECTION)
    .filter(connectionLossFilter)
    // Only retry in web env and if we're supposed to be connected
    .filter(() => inWebEnv(store.getState()) && isConnected(store.getState()))
    .throttleTime(5000)
    .do(() => store.dispatch(updateConnectionState(PENDING_STATE)))
    .mergeMap(() => {
      const connection = getActiveConnectionData(store.getState())
      if (!connection) return Rx.Observable.of(1)
      return (
        Rx.Observable.of(1)
          .mergeMap(() => {
            return new Promise((resolve, reject) => {
              bolt
                .directConnect(
                  connection,
                  {
                    connectionTimeout: getConnectionTimeout(store.getState())
                  },
                  () =>
                    setTimeout(
                      () => reject(new Error('Couldnt reconnect. Lost.')),
                      5000
                    )
                )
                .then(() => {
                  bolt.closeConnection()
                  bolt
                    .openConnection(
                      connection,
                      {
                        connectionTimeout: getConnectionTimeout(
                          store.getState()
                        )
                      },
                      onLostConnection(store.dispatch)
                    )
                    .then(() => {
                      store.dispatch(updateConnectionState(CONNECTED_STATE))
                      resolve({ type: 'Success' })
                    })
                    .catch(() => reject(new Error('Error on connect')))
                })
                .catch(e => {
                  // Don't retry if auth failed
                  if (e.code === 'Neo.ClientError.Security.Unauthorized') {
                    resolve({ type: e.code })
                  } else {
                    setTimeout(
                      () => reject(new Error('Couldnt reconnect.')),
                      5000
                    )
                  }
                })
            })
          })
          .retry(10)
          .catch(() => {
            bolt.closeConnection()
            store.dispatch(setActiveConnection(null))
            return Rx.Observable.of(null)
          })
          // It can be resolved for a number of reasons:
          // 1. Connection successful
          // 2. Auth failure
          .do((res: any) => {
            if (!res || res.type === 'Success') {
              return
            }
            // If no connection because of auth failure, close and unset active connection
            if (res.type === 'Neo.ClientError.Security.Unauthorized') {
              bolt.closeConnection()
              store.dispatch(setActiveConnection(null))
            }
          })
          .map(() => Rx.Observable.of(null))
      )
    })
    .mapTo({ type: 'NOOP' })

export const switchConnectionEpic = (action$: any, store: any) => {
  return action$
    .ofType(SWITCH_CONNECTION)
    .do(() => store.dispatch(updateConnectionState(PENDING_STATE)))
    .mergeMap((action: any) => {
      bolt.closeConnection()
      const connectionInfo = { id: discovery.CONNECTION_ID, ...action }
      store.dispatch(updateConnection(connectionInfo))
      return new Promise(resolve => {
        bolt
          .openConnection(
            action,
            { encrypted: action.encrypted },
            onLostConnection(store.dispatch)
          )
          .then(() => {
            store.dispatch(setActiveConnection(discovery.CONNECTION_ID))
            resolve({ type: SWITCH_CONNECTION_SUCCESS })
          })
          .catch(() => {
            store.dispatch(setActiveConnection(null))
            store.dispatch(
              discovery.updateDiscoveryConnection({
                username: 'neo4j',
                password: ''
              })
            )
            resolve({ type: SWITCH_CONNECTION_FAILED })
          })
      })
    })
}

export const switchConnectionSuccessEpic = (action$: any, store: any) => {
  return action$
    .ofType(SWITCH_CONNECTION_SUCCESS)
    .do(() => store.dispatch(updateConnectionState(CONNECTED_STATE)))
    .do(() => store.dispatch(fetchMetaData()))
    .mapTo(executeSystemCommand(':server switch success'))
}
export const switchConnectionFailEpic = (action$: any, store: any) => {
  return action$
    .ofType(SWITCH_CONNECTION_FAILED)
    .do(() => store.dispatch(updateConnectionState(DISCONNECTED_STATE)))
    .mapTo(executeSystemCommand(`:server switch fail`))
}
export const initialSwitchConnectionFailEpic = (action$: any, store: any) => {
  return action$
    .ofType(INITIAL_SWITCH_CONNECTION_FAILED)
    .do(() => {
      store.dispatch(updateConnectionState(DISCONNECTED_STATE))
      if (getPlayImplicitInitCommands(store.getState())) {
        store.dispatch(executeSystemCommand(`:server switch fail`))
      }
    })
    .mapTo({ type: 'NOOP' })
}

export const retainCredentialsSettingsEpic = (action$: any, store: any) => {
  return action$
    .ofType(UPDATE_RETAIN_CREDENTIALS)
    .do((action: any) => {
      const connection = getActiveConnectionData(store.getState())
      if (
        !action.shouldRetain &&
        (connection.username || connection.password)
      ) {
        memoryUsername = connection.username
        memoryPassword = connection.password
        connection.username = ''
        connection.password = ''
        return store.dispatch(updateConnection(connection))
      }
      if (action.shouldRetain && memoryUsername && memoryPassword) {
        connection.username = memoryUsername
        connection.password = memoryPassword
        memoryUsername = ''
        memoryPassword = ''
        return store.dispatch(updateConnection(connection))
      }
    })
    .mapTo({ type: 'NOOP' })
}
