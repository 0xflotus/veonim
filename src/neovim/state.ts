import { VimMode, BufferType } from '../neovim/types'
import { EventEmitter } from 'events'
import { join } from 'path'

const state = {
  background: '#2d2d2d',
  foreground: '#dddddd',
  special: '#ef5188',
  mode: VimMode.Normal,
  bufferType: BufferType.Normal,
  file: '',
  filetype: '',
  cwd: '',
  colorscheme: '',
  revision: -1,
  line: 0,
  column: 0,
  editorTopLine: 0,
  editorBottomLine: 0,
  // computed props below. these will never be updated, only computed from
  // other state values. see 'computedStateProperties' below
  absoluteFilepath: '',
}

export type NeovimState = typeof state
type StateKeys = keyof NeovimState
type WatchState = { [Key in StateKeys]: (fn: (value: NeovimState[Key]) => void) => void }

type OnStateValue1 = { [Key in StateKeys]: (value: NeovimState[Key], fn: () => void) => void }
type OnStateValue2 = { [Key in StateKeys]: (value: NeovimState[Key], previousValue: NeovimState[Key], fn: () => void) => void }
type OnStateValue = OnStateValue1 & OnStateValue2

type UntilStateValue1 = {
  [Key in StateKeys]: {
    is: (value: NeovimState[Key]) => Promise<NeovimState[Key]>
  }
}

type UntilStateValue2 = {
  [Key in StateKeys]: {
    is: (value: NeovimState[Key], previousValue: NeovimState[Key]) => Promise<NeovimState[Key]>
  }
}

type UntilStateValue = UntilStateValue1 & UntilStateValue2

const computedStateProperties = new Map<StateKeys, (state: NeovimState) => any>()
computedStateProperties.set('absoluteFilepath', (s: NeovimState) => join(s.cwd, s.file))

export default (stateName: string) => {
  const watchers = new EventEmitter()
  const stateChangeFns = new Set<Function>()

  const watchState: WatchState = new Proxy(Object.create(null), {
    get: (_, key: string) => (fn: (value: any) => void) => watchers.on(key, fn),
  })

  const onStateChange = (fn: (nextState: NeovimState, key: string, value: any, previousValue: any) => void) => {
    stateChangeFns.add(fn)
  }

  const onStateValue: OnStateValue = new Proxy(Object.create(null), {
    get: (_, key: string) => (matchValue: any, ...args: any[]) => {
      const matchPreviousValue = args.find(a => typeof a === 'string')
      const fn = args.find(a => typeof a === 'function')

      watchers.on(key, (value, previousValue) => {
        const same = value === matchValue
        const prevSame = typeof matchPreviousValue == null ? true : previousValue === matchPreviousValue
        if (same && prevSame) fn()
      })
    }
  })

  const untilStateValue: UntilStateValue = new Proxy(Object.create(null), {
    get: (_, key: string) => ({ is: (matchValue: any, matchPreviousValue?: any) => new Promise(done => {
      const callback = (value: any, previousValue: any) => {
        const same = value === matchValue
        const prevSame = typeof matchPreviousValue == null ? true : previousValue === matchPreviousValue

        if (same && prevSame) {
          done(value)
          watchers.removeListener(key, callback)
        }
      }

      watchers.on(key, callback)
    }) }),
  })

  const notifyStateChange = (nextState: NeovimState, key: string, value: any, previousValue: any) => {
    watchers.emit(key, value, previousValue)
    stateChangeFns.forEach(fn => fn(nextState, key, value, previousValue))
  }

  const stateProxy = new Proxy(state, {
    get: (_, key: StateKeys) => computedStateProperties.has(key)
      ? computedStateProperties.get(key)!(state)
      : Reflect.get(state, key),

    set: (_, key: string, val: any) => {
      const currentVal = Reflect.get(state, key)
      if (currentVal === val) return true

      const nextState = { ...state, [key]: val }

      Reflect.set(state, key, val)
      notifyStateChange(nextState, key, val, currentVal)

      return true
    }
  })

  if (process.env.VEONIM_DEV) {
    // assumes we are also using hyperapp-redux-devtools
    // we are gonna steal the modules from ^^^
    const { createStore } = require('redux')
    const { composeWithDevTools } = require('redux-devtools-extension')

    const composeEnhancers = composeWithDevTools({ name: `neovim-state-${stateName}` })
    const reducer = (state: any, action: any) => ({ ...state, ...action.payload })
    const store = createStore(reducer, state, composeEnhancers())

    store.subscribe(() => Object.assign(stateProxy, store.getState()))
    onStateChange((_, key, val) => {
      store.dispatch({ type: `SET::${key}`, payload: { [key]: val } })
    })
  }

  return { state: stateProxy, watchState, onStateChange, onStateValue, untilStateValue }
}
