// ============================================================================
// Command State Reducer
// ============================================================================

import type { Command } from '../events.ts'
import { defineReducer } from './types.ts'

export type CommandStateType = {
  commands: Map<string, Command>
}

export const commandReducer = defineReducer<CommandStateType>()({
  initialState: {
    commands: new Map()
  },

  eventTypes: [
    'command_requested',
    'execution_approved',
    'execution_rejected',
    'command_completed',
    'command_failed'
  ] as const,

  reduce: (state, event) => {
    switch (event.type) {
      case 'command_requested': {
        const command: Command = {
          commandId: event.commandId,
          command: event.command,
          params: event.params,
          status: 'requested'
        }
        return {
          commands: new Map(state.commands).set(event.commandId, command)
        }
      }

      case 'execution_approved': {
        const command = state.commands.get(event.commandId)
        if (!command) return state
        return {
          commands: new Map(state.commands).set(event.commandId, {
            ...command,
            status: 'approved'
          })
        }
      }

      case 'execution_rejected': {
        const command = state.commands.get(event.commandId)
        if (!command) return state
        return {
          commands: new Map(state.commands).set(event.commandId, {
            ...command,
            status: 'rejected'
          })
        }
      }

      case 'command_completed': {
        const command = state.commands.get(event.commandId)
        if (!command) return state
        return {
          commands: new Map(state.commands).set(event.commandId, {
            ...command,
            status: 'completed',
            result: event.result
          })
        }
      }

      case 'command_failed': {
        const command = state.commands.get(event.commandId)
        if (!command) return state
        return {
          commands: new Map(state.commands).set(event.commandId, {
            ...command,
            status: 'failed',
            error: event.error
          })
        }
      }
    }
  }
})
