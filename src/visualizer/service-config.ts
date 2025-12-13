// ============================================================================
// Visualizer Service Configuration
// ============================================================================
// This file defines the event flow graph for visualization purposes only.
// It does NOT affect the runtime behavior of services.

import { registerService, registerStateSubscription } from './registry.ts'

// Register all services with their EventBus event relationships
registerService({
  name: 'WebSocketHandler',
  publishes: ['user_message', 'execution_approved', 'execution_rejected', 'interrupt_requested'],
  subscribes: []
})

registerService({
  name: 'MessagesState',
  publishes: ['llm_response_started'],
  subscribes: ['user_message', 'llm_text_chunk', 'llm_response_completed', 'command_completed', 'command_failed']
})

registerService({
  name: 'LLMService',
  publishes: ['llm_text_chunk', 'llm_response_completed', 'llm_stream_interrupted', 'interrupt_cleanup_completed'],
  subscribes: ['llm_response_started']
})

registerService({
  name: 'CommandParser',
  publishes: ['command_requested'],
  subscribes: [] // Subscribes to MessagesState.stream, not EventBus directly
})

registerService({
  name: 'CommandState',
  publishes: ['command_started'],
  subscribes: ['command_requested', 'execution_approved', 'execution_rejected', 'command_completed', 'command_failed']
})

registerService({
  name: 'CommandExecutor',
  publishes: ['command_completed', 'command_failed', 'interrupt_cleanup_completed'],
  subscribes: ['command_started']
})

registerService({
  name: 'InterruptState',
  publishes: [],
  subscribes: ['interrupt_requested', 'interrupt_cleanup_completed']
})

// Register state subscriptions (SubscriptionRef.changes, not EventBus)
registerStateSubscription({
  from: 'MessagesState',
  to: 'CommandParser',
  label: 'state changes'
})
