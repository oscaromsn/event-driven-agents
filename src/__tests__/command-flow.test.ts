// ============================================================================
// Command Approval Flow Tests - EVENT-DRIVEN
// ============================================================================

import { describe, expect, it } from 'bun:test'
import { Effect, Layer, SubscriptionRef } from 'effect'
import { CommandExecutor } from '../services/command-executor.ts'
import { CommandState } from '../services/command-state.ts'
import { EventBus } from '../services/event-bus.ts'
import { MessagesState } from '../services/messages-state.ts'
import { UIDisplayState } from '../services/ui-display-state.ts'
import { waitForCondition } from './test-helpers.ts'

function createTestLayer() {
  return Layer.mergeAll(
    EventBus.Default,
    MessagesState.Default,
    CommandState.Default,
    CommandExecutor.Default,
    UIDisplayState.Default
  )
}

describe('Command Approval Flow', () => {
  it('should handle full approval flow: request → approve → execute → complete', async () => {
    const program = Effect.gen(function* () {
      const eventBus = yield* EventBus
      const commandState = yield* CommandState
      const uiDisplayState = yield* UIDisplayState

      const commandId = 'test_cmd_1'

      console.log('[TEST] Requesting command...')
      // Request command
      yield* eventBus.publish({
        type: 'command_requested',
        commandId,
        command: 'eval',
        params: { code: '2 + 2', description: 'Calculate 2+2' }
      })

      // WAIT FOR COMMAND TO BE IN REQUESTED STATE
      console.log('[TEST] Waiting for command request...')
      yield* waitForCondition(
        commandState.state,
        state => state.commands.has(commandId) && state.commands.get(commandId)?.status === 'requested'
      )
      console.log('[TEST] Command requested!')

      // WAIT FOR UI TO SHOW APPROVAL PROMPT
      console.log('[TEST] Waiting for approval prompt...')
      const uiWithPrompt = yield* waitForCondition(
        uiDisplayState.state,
        state => state.approvalPrompt !== null && state.approvalPrompt.commandId === commandId
      )
      console.log('[TEST] Approval prompt shown!')

      expect(uiWithPrompt.status.phase).toBe('awaiting_approval')
      expect(uiWithPrompt.approvalPrompt?.code).toBe('2 + 2')
      expect(uiWithPrompt.approvalPrompt?.description).toBe('Calculate 2+2')
      expect(uiWithPrompt.actions.canApprove).toBe(true)
      expect(uiWithPrompt.actions.canReject).toBe(true)
      expect(uiWithPrompt.actions.canSendMessage).toBe(true) // Always true!

      console.log('[TEST] Approving command...')
      // Approve
      yield* eventBus.publish({
        type: 'execution_approved',
        commandId
      })

      // WAIT FOR COMMAND TO COMPLETE
      console.log('[TEST] Waiting for command completion...')
      const finalState = yield* waitForCondition(
        commandState.state,
        state => state.commands.get(commandId)?.status === 'completed',
        5000
      )
      console.log('[TEST] Command completed!')

      const cmd = finalState.commands.get(commandId)
      expect(cmd?.status).toBe('completed')
      expect(cmd?.result).toBe('4')

      // UI should be back to idle (no approval prompt)
      const finalUI = yield* SubscriptionRef.get(uiDisplayState.state)
      expect(finalUI.approvalPrompt).toBe(null)
      expect(finalUI.actions.canApprove).toBe(false)
      expect(finalUI.actions.canReject).toBe(false)
    })

    await Effect.runPromise(
      program.pipe(
        Effect.provide(createTestLayer()),
        Effect.scoped
      )
    )
  })

  it('should handle rejection flow: request → reject', async () => {
    const program = Effect.gen(function* () {
      const eventBus = yield* EventBus
      const commandState = yield* CommandState
      const uiDisplayState = yield* UIDisplayState

      const commandId = 'test_cmd_reject'

      console.log('[TEST] Requesting command...')
      yield* eventBus.publish({
        type: 'command_requested',
        commandId,
        command: 'eval',
        params: { code: 'dangerous code' }
      })

      // WAIT FOR APPROVAL PROMPT
      console.log('[TEST] Waiting for approval prompt...')
      yield* waitForCondition(
        uiDisplayState.state,
        state => state.approvalPrompt?.commandId === commandId,
        5000
      )
      console.log('[TEST] Approval prompt shown!')

      console.log('[TEST] Rejecting command...')
      // Reject
      yield* eventBus.publish({
        type: 'execution_rejected',
        commandId,
        reason: 'User rejected'
      })

      // WAIT FOR COMMAND TO BE REJECTED
      console.log('[TEST] Waiting for rejection...')
      const finalState = yield* waitForCondition(
        commandState.state,
        state => state.commands.get(commandId)?.status === 'rejected',
        5000
      )
      console.log('[TEST] Command rejected!')

      const cmd = finalState.commands.get(commandId)
      expect(cmd?.status).toBe('rejected')
      expect(cmd?.result).toBeUndefined()

      // UI should be back to idle - wait for UI to update
      yield* waitForCondition(
        uiDisplayState.state,
        state => state.approvalPrompt === null,
        5000
      )

      const finalUI = yield* SubscriptionRef.get(uiDisplayState.state)
      expect(finalUI.approvalPrompt).toBe(null)
    })

    await Effect.runPromise(
      program.pipe(
        Effect.provide(createTestLayer()),
        Effect.scoped
      )
    )
  })

  it('should handle command execution failure gracefully', async () => {
    const program = Effect.gen(function* () {
      const eventBus = yield* EventBus
      const commandState = yield* CommandState

      const commandId = 'test_cmd_fail'

      console.log('[TEST] Requesting failing command...')
      yield* eventBus.publish({
        type: 'command_requested',
        commandId,
        command: 'eval',
        params: { code: 'throw new Error("intentional error")' }
      })

      // WAIT FOR REQUEST
      yield* waitForCondition(
        commandState.state,
        state => state.commands.has(commandId),
        5000
      )

      console.log('[TEST] Approving...')
      yield* eventBus.publish({
        type: 'execution_approved',
        commandId
      })

      // WAIT FOR FAILURE
      console.log('[TEST] Waiting for failure...')
      const finalState = yield* waitForCondition(
        commandState.state,
        state => state.commands.get(commandId)?.status === 'failed',
        5000
      )
      console.log('[TEST] Command failed as expected!')

      const cmd = finalState.commands.get(commandId)
      expect(cmd?.status).toBe('failed')
      expect(cmd?.error).toContain('intentional error')
    })

    await Effect.runPromise(
      program.pipe(
        Effect.provide(createTestLayer()),
        Effect.scoped
      )
    )
  })

  it('should only show first command in approval when multiple requested', async () => {
    const program = Effect.gen(function* () {
      const eventBus = yield* EventBus
      const uiDisplayState = yield* UIDisplayState
      const commandState = yield* CommandState

      console.log('[TEST] Requesting two commands...')
      // Request two commands
      yield* eventBus.publish({
        type: 'command_requested',
        commandId: 'cmd_1',
        command: 'eval',
        params: { code: '1 + 1' }
      })

      yield* eventBus.publish({
        type: 'command_requested',
        commandId: 'cmd_2',
        command: 'eval',
        params: { code: '2 + 2' }
      })

      // WAIT FOR FIRST APPROVAL PROMPT
      console.log('[TEST] Waiting for first approval...')
      const uiWithFirst = yield* waitForCondition(
        uiDisplayState.state,
        state => state.approvalPrompt !== null,
        5000
      )
      console.log('[TEST] First approval shown!')

      // Should show first command
      expect(uiWithFirst.approvalPrompt?.commandId).toBe('cmd_1')

      console.log('[TEST] Approving first...')
      // Approve first
      yield* eventBus.publish({
        type: 'execution_approved',
        commandId: 'cmd_1'
      })

      // WAIT FOR FIRST TO COMPLETE
      yield* waitForCondition(
        commandState.state,
        state => state.commands.get('cmd_1')?.status === 'completed',
        5000
      )

      // WAIT FOR SECOND APPROVAL PROMPT
      console.log('[TEST] Waiting for second approval...')
      const uiWithSecond = yield* waitForCondition(
        uiDisplayState.state,
        state => state.approvalPrompt?.commandId === 'cmd_2',
        5000
      )
      console.log('[TEST] Second approval shown!')

      expect(uiWithSecond.approvalPrompt?.commandId).toBe('cmd_2')
    })

    await Effect.runPromise(
      program.pipe(
        Effect.provide(createTestLayer()),
        Effect.scoped
      )
    )
  })

  it('should handle multiple approvals of same command (idempotent)', async () => {
    const program = Effect.gen(function* () {
      const eventBus = yield* EventBus
      const commandState = yield* CommandState

      const commandId = 'cmd_dup'

      console.log('[TEST] Requesting command...')
      yield* eventBus.publish({
        type: 'command_requested',
        commandId,
        command: 'eval',
        params: { code: '5 * 5' }
      })

      // WAIT FOR REQUEST
      yield* waitForCondition(
        commandState.state,
        state => state.commands.has(commandId),
        5000
      )

      console.log('[TEST] Sending multiple approvals...')
      // Send multiple approvals (user clicks multiple times)
      yield* eventBus.publish({ type: 'execution_approved', commandId })
      yield* eventBus.publish({ type: 'execution_approved', commandId })
      yield* eventBus.publish({ type: 'execution_approved', commandId })

      // WAIT FOR COMPLETION
      console.log('[TEST] Waiting for completion...')
      const finalState = yield* waitForCondition(
        commandState.state,
        state => state.commands.get(commandId)?.status === 'completed',
        5000
      )
      console.log('[TEST] Completed!')

      const cmd = finalState.commands.get(commandId)
      expect(cmd?.status).toBe('completed')
      expect(cmd?.result).toBe('25')
      // Should have only executed once (not 3 times)
    })

    await Effect.runPromise(
      program.pipe(
        Effect.provide(createTestLayer()),
        Effect.scoped
      )
    )
  })

  it('should handle approval for non-existent command gracefully', async () => {
    const program = Effect.gen(function* () {
      const eventBus = yield* EventBus
      const commandState = yield* CommandState

      console.log('[TEST] Approving non-existent command...')
      // Approve non-existent command
      yield* eventBus.publish({
        type: 'execution_approved',
        commandId: 'does_not_exist'
      })

      // Give it a moment to process
      yield* Effect.sleep('100 millis')

      // Should not crash, should just ignore
      const state = yield* SubscriptionRef.get(commandState.state)
      expect(state.commands.has('does_not_exist')).toBe(false)
    })

    await Effect.runPromise(
      program.pipe(
        Effect.provide(createTestLayer()),
        Effect.scoped
      )
    )
  })
})
