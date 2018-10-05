import { on, onCreateVim, onSwitchVim } from '../messaging/worker-client'
import TextDocumentManager from '../neovim/text-document-manager'
import SessionTransport from '../messaging/session-transport'
import { filter as fuzzy } from 'fuzzaldrin-plus'
import SetupRPC from '../messaging/rpc'
import Neovim from '../neovim/api'

const { send, connectTo, switchTo, onRecvData } = SessionTransport()
const { onData, ...rpcAPI } = SetupRPC(send)

onRecvData(([ type, d ]) => onData(type, d))
onCreateVim(connectTo)
onSwitchVim(switchTo)

const nvim = Neovim({ ...rpcAPI, onCreateVim, onSwitchVim })
const tdm = TextDocumentManager(nvim)
const keywords = new Map<string, string[]>()
let isInsertMode = false

const addKeyword = (file: string, word: string) => {
  const e = keywords.get(file) || []
  if (e.includes(word)) return
  keywords.set(file, (e.push(word), e))
}

const harvest = (file: string, buffer: string[]) => {
  if (isInsertMode) return

  const harvested = new Set<string>()
  const totalol = buffer.length

  for (let ix = 0; ix < totalol; ix++) {
    const words = buffer[ix].match(/[A-Za-z]\w+/g) || []
    const wordsTotal = words.length

    for (let wix = 0; wix < wordsTotal; wix++) {
      const word = words[wix]
      if (word.length > 2) harvested.add(word)
    }
  }

  const nextKeywords = new Set([...keywords.get(file) || [], ...harvested])
  keywords.set(file, [...nextKeywords])
}

nvim.on.insertEnter(() => isInsertMode = true)
nvim.on.insertLeave(() => isInsertMode = false)

tdm.on.didOpen(({ name, textLines }) => harvest(name, textLines))
tdm.on.didChange(({ name, textLines }) => harvest(name, textLines))
tdm.on.didClose(({ name }) => keywords.delete(name))

on.add((file: string, word: string) => addKeyword(file, word))
on.query(async (file: string, query: string, maxResults = 20) => {
  return fuzzy(keywords.get(file) || [], query, { maxResults })
})
