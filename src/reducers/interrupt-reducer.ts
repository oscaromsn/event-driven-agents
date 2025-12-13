// ============================================================================
// Interrupt State Reducer
// ============================================================================

import { defineReducer } from './types.ts'

export type InterruptStateType = {
  requestedCount: number
  completedCount: number
  isPending: boolean
  currentStreamId: string | null
}

export const interruptReducer = defineReducer<InterruptStateType>()({
  initialState: {
    requestedCount: 0,
    completedCount: 0,
    isPending: false,
    currentStreamId: null
  },

  eventTypes: [
    'interrupt_requested',
    'interrupt_cleanup_completed'
  ] as const,

  reduce: (state, event) => {
    switch (event.type) {
      case 'interrupt_requested': {
        const newRequested = state.requestedCount + 1
        console.log('[InterruptState] Interrupt requested, count:', newRequested)
        return {
          ...state,
          requestedCount: newRequested,
          isPending: newRequested > state.completedCount
        }
      }

      case 'interrupt_cleanup_completed': {
        const newCompleted = state.completedCount + 1
        console.log('[InterruptState] Interrupt cleanup completed, count:', newCompleted)
        return {
          requestedCount: state.requestedCount,
          completedCount: newCompleted,
          isPending: state.requestedCount > newCompleted,
          currentStreamId: null
        }
      }
    }
  }
})
